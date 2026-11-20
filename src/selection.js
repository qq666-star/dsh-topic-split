/** 轮次选择：把「连续区间 ranges」与「任意轮次集合 turns」统一成有序、去重、相邻合并的连续块。
 *
 * 为什么需要 turns：主题在会话里是交错的（同一主题会散落在几十个位置），
 * 只用连续区间导出时，要么漏掉同主题的散点，要么把无关轮次一起带出去。
 */

import { ERR, SessionSplitError } from './errors.js'

/**
 * 解析 "0-51,52-87" 形式的区间串（`end` 表示最后一轮）。
 * @param {string} spec 例如 "0-51,52-87" 或 "78-end"
 * @param {number} totalTurns 会话总轮次
 * @param {{maxRanges:number}} cfg 已校验配置
 * @returns {Array<[number, number]>}
 */
export function parseRanges(spec, totalTurns, cfg) {
  const text = String(spec ?? '').trim()
  if (!text) throw new SessionSplitError(ERR.RANGE_INVALID, '需要 ranges，例如 0-51 或 0-51,52-87')
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length > cfg.maxRanges) {
    throw new SessionSplitError(ERR.RANGE_TOO_MANY, `区间数量过多（上限 ${cfg.maxRanges} 段）`)
  }
  return parts.map((part) => {
    const m = /^(\d+)\s*-\s*(\d+|end)$/.exec(part)
    if (!m) throw new SessionSplitError(ERR.RANGE_INVALID, `区间格式不对：${part}`)
    const from = Number(m[1])
    const to = m[2] === 'end' ? totalTurns - 1 : Number(m[2])
    if (from > to) throw new SessionSplitError(ERR.RANGE_INVALID, `区间起点大于终点：${part}`)
    if (to >= totalTurns) throw new SessionSplitError(ERR.RANGE_INVALID, `区间超出范围（共 ${totalTurns} 轮）：${part}`)
    return [from, to]
  })
}

/** 把有序轮次下标合并成连续块（相邻即合并）。 */
export function toRuns(indices) {
  const runs = []
  for (const n of indices) {
    const last = runs[runs.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return runs
}

/**
 * 解析 turns：逗号分隔，每项为单轮 `N` 或区间 `A-B`。
 * @param {string} spec 例如 "3,7-9,20"
 * @param {number} totalTurns 会话总轮次
 * @param {{maxRanges:number}} cfg 已校验配置
 * @returns {{runs:Array<[number,number]>, indices:number[], normalized:boolean}}
 */
export function parseTurnSpec(spec, totalTurns, cfg) {
  const text = String(spec ?? '').trim()
  if (!text) throw new SessionSplitError(ERR.TURNS_INVALID, '需要 turns，例如 3,7-9,20')
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new SessionSplitError(ERR.TURNS_INVALID, 'turns 为空')
  if (parts.length > cfg.maxRanges) {
    throw new SessionSplitError(ERR.RANGE_TOO_MANY, `轮次项过多（上限 ${cfg.maxRanges} 项）`)
  }
  const picked = []
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!m) throw new SessionSplitError(ERR.TURNS_INVALID, `轮次格式不对：${part}（应为 3 或 3-5）`)
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from > to) throw new SessionSplitError(ERR.TURNS_INVALID, `轮次起点大于终点：${part}`)
    if (to >= totalTurns) {
      throw new SessionSplitError(
        ERR.TURNS_INVALID,
        `轮次超出范围（共 ${totalTurns} 轮，下标 0..${totalTurns - 1}）：${part}`,
      )
    }
    for (let i = from; i <= to; i++) picked.push(i)
  }
  return normalize(picked, parts.length)
}

/**
 * 把区间展开成规范化选择（重叠区间会被合并，避免重复计数）。
 * @param {Array<[number, number]>} ranges
 * @returns {{runs:Array<[number,number]>, indices:number[], normalized:boolean}}
 */
export function selectionFromRanges(ranges) {
  const picked = []
  for (const [from, to] of ranges) {
    for (let i = from; i <= to; i++) picked.push(i)
  }
  return normalize(picked, ranges.length)
}

/**
 * 解析工具参数中的 turns / ranges（二者互斥）。
 * @param {Record<string, unknown>} args 工具参数
 * @param {number} totalTurns 会话总轮次
 * @param {{maxRanges:number}} cfg 已校验配置
 * @returns {{source:string, runs:Array<[number,number]>, indices:number[], normalized:boolean}|null}
 */
export function selectionFromArgs(args, totalTurns, cfg) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const turns = text(args?.turns)
  const rangesText = text(args?.ranges)
  if (turns && rangesText) {
    throw new SessionSplitError(ERR.TURNS_INVALID, 'ranges 与 turns 只能给一个')
  }
  if (turns) return { source: 'turns', ...parseTurnSpec(turns, totalTurns, cfg) }
  if (rangesText) return { source: 'ranges', ...selectionFromRanges(parseRanges(rangesText, totalTurns, cfg)) }
  return null
}

function normalize(picked, inputCount) {
  const indices = [...new Set(picked)].sort((a, b) => a - b)
  if (indices.length === 0) throw new SessionSplitError(ERR.TURNS_INVALID, '选择为空')
  const runs = toRuns(indices)
  return { runs, indices, normalized: runs.length !== inputCount }
}

/**
 * 二维覆盖率：选中 + 排除 = 全部（轮次与字数双维度）。
 * @param {Array<{user:string, assistant:string}>} items 全部轮次
 * @param {number[]} indices 被选中的轮次下标
 * @returns {object} 覆盖率明细
 */
export function selectionCoverage(items, indices) {
  const totalTurns = items.length
  let totalChars = 0
  for (const item of items) totalChars += item.user.length + item.assistant.length
  let selectedChars = 0
  for (const i of indices) selectedChars += items[i].user.length + items[i].assistant.length
  const excludedTurns = totalTurns - indices.length
  const excludedChars = totalChars - selectedChars
  return {
    totalTurns,
    totalChars,
    selectedTurns: indices.length,
    selectedChars,
    excludedTurns,
    excludedChars,
    complete: indices.length === totalTurns,
    ok: indices.length + excludedTurns === totalTurns && selectedChars + excludedChars === totalChars,
  }
}

/**
 * 人类可读的连续块描述，例如 "1, 5-6, 9"。
 * @param {Array<[number, number]>} runs
 * @param {number} [limit] 最多显示多少个块
 */
export function describeRuns(runs, limit = 12) {
  const shown = runs
    .slice(0, limit)
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join(', ')
  return runs.length > limit ? `${shown} …（共 ${runs.length} 段）` : shown
}
