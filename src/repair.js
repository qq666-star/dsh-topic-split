/** 启动自愈：把历史版本留下的 `.archived-session-*` 目录改回 `session-*`。
 *
 * 为什么必须修：DSH 读取会话列表时，会用每个会话文件头里的 `id` 与 `cwd` 重新
 * 推导它应该所在的路径，并要求与实际路径一致（`corrupt session log ... header id
 * and cwd identify ...`）。目录一旦被改名成 `.archived-session-<id>-<时间戳>`，
 * 这条校验就失败，**整份** `session/list` 直接报错，侧边栏的会话列表整块消失；
 * 因为坏的是磁盘状态，重启也不会好，只有修复目录名才能恢复。
 *
 * 0.9.1 之前的版本正用「重命名目录」实现归档，所以这里在插件启动时顺手修一遍。
 */
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { sessionsRoot } from './store.js'

/** `.archived-session-<uuid>-<时间戳>` / `.archived-session-<uuid>-<时间戳>-<n>` */
const ARCHIVED_DIR_RE =
  /^\.archived-(session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i

/**
 * 找出所有被改名的归档会话目录（只读，不改动）。
 * @returns {Array<{workspace: string, name: string, id: string, path: string, target: string}>}
 */
export function listArchivedDirs() {
  const found = []
  const root = sessionsRoot()
  if (!existsSync(root)) return found
  for (const workspace of readdirSync(root)) {
    const workspaceDir = join(root, workspace)
    let entries
    try {
      if (!statSync(workspaceDir).isDirectory()) continue
      entries = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const name of entries) {
      const match = ARCHIVED_DIR_RE.exec(name)
      if (!match) continue
      found.push({
        workspace,
        name,
        id: match[1],
        path: join(workspaceDir, name),
        target: join(workspaceDir, match[1]),
      })
    }
  }
  return found
}

/**
 * 扫描会话根目录，把被改名的归档目录恢复成 `session-<id>`。
 *
 * 只处理能唯一还原目标名字的条目；目标已存在时跳过并告警，绝不覆盖。
 * @param {{log?: {warn?: Function}}} [input]
 * @returns {Array<{id: string, path: string}>} 已修复的条目
 */
export function repairArchivedDirs({ log } = {}) {
  const repaired = []
  for (const entry of listArchivedDirs()) {
    if (existsSync(entry.target)) {
      log?.warn?.(`归档目录自愈跳过（目标已存在）：${entry.name}`)
      continue
    }
    try {
      renameSync(entry.path, entry.target)
      repaired.push({ id: entry.id, path: entry.target })
      log?.warn?.(`归档目录自愈：${entry.name} → ${entry.id}（目录名被改过会让 DSH 整份会话列表读不出来）`)
    } catch (err) {
      log?.warn?.(`归档目录自愈失败：${entry.name}：${err && err.message ? err.message : err}`)
    }
  }
  return repaired
}
