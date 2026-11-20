/** 会话登记与归档：优先走 DSH 的 workspaceRegistry 服务，文件写入仅作兜底。
 *
 * 背景：直接改写 `workspace.json` 会与 DSH 内存中的注册表快照竞争，
 * 导致插件创建的会话被覆盖、侧边栏条目消失。服务 API 才是正确路径。
 *
 * 归档同样如此：DSH 的归档语义是「把 id 记进 `global.archivedSessionIds`」，
 * 会话目录必须保持 `session-<id>` 不动。历史版本用「重命名目录」实现归档，
 * 那会让 DSH 的会话列表读取整份失败（侧边栏会话列表消失），已废弃。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { ERR, SessionSplitError } from './errors.js'
import { atomicWrite, readRegistry, registryPath, writeRegistry } from './store.js'

/**
 * 解析 workspaceRegistry 服务：优先取动态注入的实例，其次属性/ctx.get。
 * @param {any} ctx cordis 上下文
 * @param {() => any} [getService] 动态注入回调提供的实例
 */
function resolveRegistry(ctx, getService) {
  try {
    const injected = typeof getService === 'function' ? getService() : null
    if (injected && typeof injected.resolveByPath === 'function') return injected
  } catch {
    /* 忽略 */
  }
  if (!ctx) return null
  try {
    const direct = ctx.workspaceRegistry
    if (direct && typeof direct.resolveByPath === 'function') return direct
  } catch {
    /* 服务未注入时会抛错，继续尝试 ctx.get */
  }
  try {
    const got = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
    if (got && typeof got.resolveByPath === 'function') return got
  } catch {
    /* 忽略 */
  }
  return null
}

function findWorkspace(registry, cwd) {
  const workspaces = registry?.tables?.workspaces ?? {}
  return Object.values(workspaces).find(
    (w) => String(w?.path ?? '').toLowerCase() === String(cwd ?? '').toLowerCase(),
  )
}

/** 兜底：文件读-改-写，带备份与回读校验；只增删目标 id。 */
function fileAdd(cwd, sessionId) {
  const file = registryPath()
  const backup = `${file}.bak-registry-${Date.now()}`
  if (existsSync(file)) {
    writeFileSync(backup, readFileSync(file))
  }
  const reg = readRegistry()
  reg.tables ??= { workspaces: {} }
  reg.tables.workspaces ??= {}
  let target = findWorkspace(reg, cwd)
  if (!target) {
    target = {
      path: cwd,
      title: String(cwd).split(/[\\/]/).pop() || cwd,
      sessionIds: [],
      updatedAt: new Date().toISOString(),
    }
    reg.tables.workspaces[`fallback-${Date.now()}`] = target
  }
  target.sessionIds = [sessionId, ...(target.sessionIds ?? []).filter((id) => id !== sessionId)]
  target.updatedAt = new Date().toISOString()
  writeRegistry(reg)
  const check = readRegistry()
  const ok = (findWorkspace(check, cwd)?.sessionIds ?? []).includes(sessionId)
  if (!ok) {
    if (existsSync(backup)) {
      try {
        atomicWrite(file, readFileSync(backup))
      } catch {
        /* 尽力回滚 */
      }
    }
    throw new SessionSplitError(ERR.IO_FAILED, '会话登记写入校验失败，已回滚')
  }
}

/** 兜底：文件移除目标 id（不触碰其它条目）。 */
function fileRemove(cwd, sessionId) {
  const file = registryPath()
  const backup = `${file}.bak-registry-${Date.now()}`
  if (existsSync(file)) writeFileSync(backup, readFileSync(file))
  const reg = readRegistry()
  const target = findWorkspace(reg, cwd)
  if (!target) return
  target.sessionIds = (target.sessionIds ?? []).filter((id) => id !== sessionId)
  target.updatedAt = new Date().toISOString()
  writeRegistry(reg)
  const check = readRegistry()
  const still = (findWorkspace(check, cwd)?.sessionIds ?? []).includes(sessionId)
  if (still) {
    if (existsSync(backup)) {
      try {
        atomicWrite(file, readFileSync(backup))
      } catch {
        /* 尽力回滚 */
      }
    }
    throw new SessionSplitError(ERR.IO_FAILED, '会话注销校验失败，已回滚')
  }
}

/**
 * 兜底：把 id 写进 `global.archivedSessionIds`（只增，不碰会话目录）。
 * @param {string} sessionId 要归档的会话 id
 */
function fileArchive(sessionId) {
  const file = registryPath()
  const backup = `${file}.bak-archive-${Date.now()}`
  if (existsSync(file)) writeFileSync(backup, readFileSync(file))
  const reg = readRegistry()
  reg.global ??= {}
  const current = Array.isArray(reg.global.archivedSessionIds) ? reg.global.archivedSessionIds : []
  if (!current.includes(sessionId)) reg.global.archivedSessionIds = [...current, sessionId]
  writeRegistry(reg)
  const check = readRegistry()
  const ok = (check.global?.archivedSessionIds ?? []).includes(sessionId)
  if (!ok) {
    if (existsSync(backup)) {
      try {
        atomicWrite(file, readFileSync(backup))
      } catch {
        /* 尽力回滚 */
      }
    }
    throw new SessionSplitError(ERR.IO_FAILED, '会话归档写入校验失败，已回滚')
  }
}

/**
 * 创建登记器。
 * @param {{ctx?: any, log?: {warn: Function}, getService?: () => any}} input
 */
export function createRegistrar({ ctx, log, getService } = {}) {
  let announced = false
  const announce = (service) => {
    if (announced) return
    announced = true
    log?.info?.(`会话登记方式：${service ? 'workspaceRegistry 服务' : '文件兜底'}`)
  }
  return {
    get mode() {
      return resolveRegistry(ctx, getService) ? 'service' : 'file'
    },
    /**
     * 登记一个刚创建的会话。
     * @param {string} cwd 工作目录
     * @param {string} sessionId 会话 id
     */
    async register(cwd, sessionId) {
      const service = resolveRegistry(ctx, getService)
      announce(service)
      if (!service) return fileAdd(cwd, sessionId)
      try {
        const ws = await service.resolveByPath(cwd)
        await ws.attachSession(sessionId)
        return
      } catch (err) {
        log?.warn('workspaceRegistry.attachSession 失败，回退文件登记：', err?.message ?? err)
        return fileAdd(cwd, sessionId)
      }
    },
    /**
     * 注销一个会话：只从 workspace 的 `sessionIds` 里摘掉，不归档、不碰目录。
     * @param {string} cwd 工作目录
     * @param {string} sessionId 会话 id
     */
    async unregister(cwd, sessionId) {
      const service = resolveRegistry(ctx, getService)
      announce(service)
      if (!service) return fileRemove(cwd, sessionId)
      try {
        const ws = await service.resolveByPath(cwd)
        await ws.detachSession(sessionId)
        return
      } catch (err) {
        log?.warn('workspaceRegistry.detachSession 失败，回退文件注销：', err?.message ?? err)
        return fileRemove(cwd, sessionId)
      }
    },
    /**
     * 归档一个会话：只改注册表的归档集合，绝不重命名会话目录。
     * 服务可用时必须走服务（DSH 会校验会话是否仍在跑，并即时广播给客户端）。
     * @param {string} cwd 工作目录（服务路径下只用于诊断）
     * @param {string} sessionId 会话 id
     * @returns {Promise<'service'|'file'>} 实际使用的归档方式
     */
    async archive(cwd, sessionId) {
      const service = resolveRegistry(ctx, getService)
      announce(service)
      if (!service || typeof service.archiveSession !== 'function') {
        fileArchive(sessionId)
        return 'file'
      }
      try {
        await service.archiveSession(sessionId)
        return 'service'
      } catch (err) {
        // 归档被 DSH 拒绝（例如会话正在跑、或会话不被持久化层认识）时不能退回改名，
        // 也不能退回写文件：那样要么破坏会话列表，要么绕过「活跃会话不可归档」的保护。
        const reason = err?.message ? err.message : String(err)
        throw new SessionSplitError(
          ERR.IO_FAILED,
          `DSH 拒绝归档会话 ${sessionId}（${reason}）；会话目录未改动`,
          { sessionId, cwd: String(cwd ?? '') },
        )
      }
    },
  }
}
