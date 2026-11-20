/** 剪除：把指定轮次从会话中移除，用剩余轮次重建新会话；可选归档原会话。
 *
 * DSH 会话是 append-only 事件流，不能从中间物理删除事件，
 * 因此这里用「剩余轮次重建」的方式实现剪除。
 *
 * 归档只登记到 workspace 注册表的 `archivedSessionIds`（见 registry.archive），
 * **绝不重命名会话目录**：DSH 读取会话列表时，会用每个会话文件头里的 id 与 cwd
 * 重新推导它应该在的路径，并要求与实际路径一致；目录一旦被改名，整份会话列表
 * 读取都会失败，侧边栏的会话列表会整块消失（重启后才暴露）。
 */

/**
 * 判断某一轮是否落在区间内。
 * @param {number} turn 0 基轮次
 * @param {Array<[number, number]>} ranges
 * @returns {boolean}
 */
export function inRanges(turn, ranges) {
  return ranges.some(([from, to]) => turn >= from && turn <= to)
}

/**
 * 计算剪除计划：被剪掉多少、剩下多少。
 * @param {Array<{user:string, assistant:string}>} items
 * @param {Array<[number, number]>} ranges
 */
export function planCut(items, ranges) {
  let removedTurns = 0
  let removedChars = 0
  let remainingTurns = 0
  let remainingChars = 0
  const keep = []
  items.forEach((item, index) => {
    const chars = item.user.length + item.assistant.length
    if (inRanges(index, ranges)) {
      removedTurns += 1
      removedChars += chars
    } else {
      remainingTurns += 1
      remainingChars += chars
      keep.push({ turn: index, user: item.user, assistant: item.assistant })
    }
  })
  return { keep, removedTurns, removedChars, remainingTurns, remainingChars }
}

/**
 * 把 (用户, 助手) 配对列表转成 createSession 需要的元组。
 * @param {Array<{user:string, assistant:string}>} keep
 * @returns {Array<[string, string]>}
 */
export function toPairs(keep) {
  return keep.map((item) => [item.user, item.assistant])
}
