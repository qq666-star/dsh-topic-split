/** 语义分段：模型给边界 → 结构校验 → 短段平滑 → 补字数。失败交给上层回退。 */
import { segmentByJudge } from './judge.js'

/** 计算区间字数。 */
function charsOf(items, from, to) {
  let n = 0
  for (let i = from; i <= to; i++) n += items[i].user.length + items[i].assistant.length
  return n
}

/**
 * 把过短的段并入相邻段（优先并入前一段），避免模型切得太碎。
 * @param {Array<{turn:number,user:string,assistant:string}>} items
 * @param {Array<{label:string, from:number, to:number}>} segs
 * @param {{minSegmentTurns:number, minSegmentChars:number}} cfg
 * @returns {Array<{label:string, from:number, to:number, chars:number}>}
 */
export function smoothSegments(items, segs, cfg) {
  const merged = []
  for (const seg of segs) {
    const chars = charsOf(items, seg.from, seg.to)
    const small = seg.to - seg.from + 1 < cfg.minSegmentTurns || chars < cfg.minSegmentChars
    const prev = merged[merged.length - 1]
    if (prev && small) {
      prev.to = seg.to
      prev.chars += chars
      continue
    }
    merged.push({ ...seg, chars })
  }
  return merged.map((seg) => ({ ...seg }))
}

/**
 * 用判断模型分段。
 * @param {Array<{turn:number,user:string,assistant:string}>} items
 * @param {{complete:Function, kind:string}} judge
 * @param {object} cfg
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{label:string, from:number, to:number, chars:number}>>}
 */
export async function segmentByModel(items, judge, cfg, signal) {
  const raw = await segmentByJudge(judge, items, cfg, signal)
  return smoothSegments(items, raw, cfg)
}
