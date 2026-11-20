/** 会话存储层：路径、注册表、扫描、解析缓存。全部只读源会话。 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import { ERR, SessionSplitError } from './errors.js'
import { decodeSession } from './zstd.js'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/

/** DSH 根目录（尊重 DSH_HOME 覆盖）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 会话根目录。 */
export function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/** workspace 注册表路径。 */
export function registryPath() {
  return join(dshHome(), 'storages', 'workspace.json')
}

/**
 * 项目目录键：与 DSH 的 `projectKey` 完全一致。
 *
 * 规则：分隔符（`/` `\` `:`）折叠为 `-`；不安全码元转成 `~XXXX`（大写十六进制）；
 * 前缀 `--`、去掉前导 `-`、截断到 251 字符、后缀 `--`；空路径回退 `root`。
 * 跨平台正确性依赖它：如果这里和 DSH 不一致，导出的会话会落到错误的目录。
 * @param {string} cwd 会话的工作目录
 * @returns {string}
 */
export function slugFor(cwd) {
  const raw = String(cwd ?? '')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 校验并规范化会话 id（只允许字母数字与连字符）。 */
export function assertSessionId(id) {
  const value = String(id ?? '')
  if (!ID_RE.test(value)) {
    throw new SessionSplitError(ERR.SESSION_ID_INVALID, `会话 id 非法：${value || '(空)'}`)
  }
  return value
}

/**
 * 按平台语义比较两个路径：Windows 大小写不敏感，POSIX 敏感。
 * @param {string} a 路径 A
 * @param {string} b 路径 B
 * @param {NodeJS.Platform} [platform] 平台标识（测试可注入）
 * @returns {boolean}
 */
export function samePath(a, b, platform = process.platform) {
  const left = String(a ?? '').trim()
  const right = String(b ?? '').trim()
  // 空路径不能被 resolve 成当前目录，否则会误匹配
  if (!left || !right) return false
  const l = resolve(left)
  const r = resolve(right)
  return platform === 'win32' ? l.toLowerCase() === r.toLowerCase() : l === r
}

/**
 * 判断 target 是否位于 root 之内（含等于）。
 * @param {string} root 根目录
 * @param {string} target 目标路径
 * @param {NodeJS.Platform} [platform] 平台标识（测试可注入）
 * @returns {boolean}
 */
export function isInsideRoot(root, target, platform = process.platform) {
  const r = platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)
  const t = platform === 'win32' ? resolve(target).toLowerCase() : resolve(target)
  return t === r || t.startsWith(r + sep)
}

/**
 * 确保路径位于会话根目录内，防止路径穿越。
 * @param {string} file 待校验路径
 * @param {NodeJS.Platform} [platform] 平台标识（测试可注入）
 * @returns {string} 规范化后的绝对路径
 */
export function assertInsideRoot(file, platform = process.platform) {
  const root = resolve(sessionsRoot())
  const target = resolve(file)
  if (!isInsideRoot(root, target, platform)) {
    throw new SessionSplitError(ERR.PATH_OUTSIDE_ROOT, `路径越界：${target}`)
  }
  return target
}

/** 列出所有会话文件（不解析）。 */
export function listSessions() {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  const out = []
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws)
    let st
    try {
      st = statSync(wsDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    for (const dirName of readdirSync(wsDir)) {
      if (!dirName.startsWith('session-')) continue
      const file = join(wsDir, dirName, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      try {
        const s = statSync(file)
        out.push({ workspace: ws, dirName, file, size: s.size, mtime: s.mtimeMs })
      } catch {
        /* 忽略被删除的条目 */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** 按 id 或前缀找会话。 */
export function resolveSession(idOrPrefix) {
  const needle = assertSessionId(idOrPrefix)
  const all = listSessions()
  const exact = all.find((s) => s.dirName === needle)
  if (exact) return exact
  const byPrefix = all.filter(
    (s) => s.dirName.startsWith(needle) || s.dirName.slice('session-'.length).startsWith(needle),
  )
  if (byPrefix.length === 1) return byPrefix[0]
  if (byPrefix.length > 1) {
    throw new SessionSplitError(ERR.SESSION_ID_INVALID, `前缀 ${needle} 匹配到 ${byPrefix.length} 个会话，请写完整 id`)
  }
  throw new SessionSplitError(ERR.SESSION_NOT_FOUND, `找不到会话：${needle}`)
}

/** 带 mtime+size 校验的解析缓存。 */
export function createSessionReader(cfg) {
  const cache = new Map()
  const stats = { hits: 0, misses: 0, lastParseMs: 0 }
  const reader = function readSession(file) {
    const target = assertInsideRoot(file)
    const st = statSync(target)
    if (st.size > cfg.maxCompressedBytes) {
      throw new SessionSplitError(ERR.FILE_TOO_LARGE, `会话文件过大（${Math.round(st.size / 1024 / 1024)} MB），已跳过`)
    }
    const hit = cache.get(target)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      stats.hits += 1
      return hit.value
    }

    const startedAt = Date.now()
    const parsed = decodeSession(readFileSync(target))
    stats.misses += 1
    stats.lastParseMs = Date.now() - startedAt
    if (!parsed.header) throw new SessionSplitError(ERR.FILE_CORRUPT, `会话文件为空或损坏：${target}`)
    const inflated = JSON.stringify(parsed).length
    if (inflated > cfg.maxInflatedBytes) {
      throw new SessionSplitError(ERR.FILE_TOO_LARGE, `会话解析后过大（${Math.round(inflated / 1024 / 1024)} MB），已跳过`)
    }
    if (cache.size >= cfg.cacheEntries) cache.delete(cache.keys().next().value)
    cache.set(target, { mtimeMs: st.mtimeMs, size: st.size, value: parsed })
    return parsed
  }
  reader.stats = () => ({ ...stats, size: cache.size })
  return reader
}

/** 读取 workspace 注册表（缺失时返回空结构）。 */
export function readRegistry() {
  const file = registryPath()
  if (!existsSync(file)) return { global: {}, tables: { workspaces: {} } }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 原子写：先写 .tmp 再 rename，避免半截文件。 */
export function atomicWrite(file, buf) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, buf)
  try {
    renameSync(tmp, file)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw new SessionSplitError(ERR.IO_FAILED, `写入失败：${err.message}`)
  }
}

/** 原子写回注册表。 */
export function writeRegistry(data) {
  atomicWrite(registryPath(), Buffer.from(JSON.stringify(data, null, 2), 'utf8'))
}

/** 在注册表里登记新会话（必要时新建 workspace 条目）。 */
export function registerSession(cwd, sessionId) {
  const reg = readRegistry()
  reg.tables ??= { workspaces: {} }
  reg.tables.workspaces ??= {}
  let target = Object.values(reg.tables.workspaces).find((w) => samePath(w?.path, cwd))
  if (!target) {
    const id = randomUUID()
    const now = new Date().toISOString()
    target = {
      path: cwd,
      title: String(cwd).split(/[\\/]/).pop() || cwd,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    reg.tables.workspaces[id] = target
    reg.global ??= {}
    reg.global.workspaceIds = [...(reg.global.workspaceIds ?? []), id]
  }
  target.sessionIds = [sessionId, ...(target.sessionIds ?? []).filter((i) => i !== sessionId)]
  target.updatedAt = new Date().toISOString()
  writeRegistry(reg)
}

/**
 * 从注册表里移除一个会话（归档后调用，避免列表出现悬空条目）。
 * @param {string} cwd 工作目录
 * @param {string} sessionId 会话 id
 */
export function unregisterSession(cwd, sessionId) {
  const reg = readRegistry()
  const workspaces = reg?.tables?.workspaces
  if (!workspaces) return
  let changed = false
  for (const ws of Object.values(workspaces)) {
    if (!samePath(ws?.path, cwd) || !Array.isArray(ws.sessionIds)) continue
    const next = ws.sessionIds.filter((id) => id !== sessionId)
    if (next.length !== ws.sessionIds.length) {
      ws.sessionIds = next
      ws.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) writeRegistry(reg)
}
