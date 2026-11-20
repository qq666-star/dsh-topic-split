/** 主题分段：把事件流抽成轮次文本，按规则分类并平滑成粗粒度段落。 */

export const OTHER_LABEL = '其他'

/**
 * 抽取每一轮的用户文本与助手文本。
 * @param {Array<Record<string, any>>} events
 * @returns {Array<{turn:number, user:string, assistant:string}>}
 */
export function extractTurns(events) {
  const starts = []
  events.forEach((e, i) => {
    if (e?.type === 'turn/start') starts.push(i)
  })
  return starts.map((from, index) => {
    const to = index + 1 < starts.length ? starts[index + 1] : events.length
    const slice = events.slice(from, to)
    const user = slice
      .filter((e) => e?.type === 'user/message')
      .map((e) => textOf(e.data))
      .filter(Boolean)
      .join('\n\n')
    const assistant = slice
      .filter((e) => e?.type === 'assistant/message')
      .map((e) => textOf(e.data?.message))
      .filter(Boolean)
      .join('\n\n')
    return { turn: index, user, assistant }
  })
}

function textOf(msg) {
  if (!msg || !Array.isArray(msg.content)) return ''
  return msg.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
}

/** 单轮分类：用户原文优先，助手文本只看前 400 字。 */
export function classify(item, rules) {
  const haystack = (item.user || '') + '\n' + (item.assistant || '').slice(0, 400)
  for (const { label, re } of rules) {
    if (re.test(haystack)) return label
  }
  return OTHER_LABEL
}

/** 原始分段（相邻同标签合并）。 */
function rawSegments(items, rules) {
  const out = []
  for (const item of items) {
    const label = classify(item, rules)
    const chars = item.user.length + item.assistant.length
    const last = out[out.length - 1]
    if (last && last.label === label) {
      last.to = item.turn
      last.chars += chars
    } else {
      out.push({ label, from: item.turn, to: item.turn, chars })
    }
  }
  return out
}

/**
 * 平滑分段：短段并入相邻段，避免关键词抖动切碎。
 * @param {Array<{turn:number,user:string,assistant:string}>} items
 * @param {Array<{label:string,re:RegExp}>} rules
 * @param {{minSegmentTurns:number, minSegmentChars:number}} cfg
 */
export function segment(items, rules, cfg) {
  const merged = []
  for (const seg of rawSegments(items, rules)) {
    const small = seg.to - seg.from + 1 < cfg.minSegmentTurns || seg.chars < cfg.minSegmentChars
    const prev = merged[merged.length - 1]
    if (!prev) {
      merged.push({ ...seg })
      continue
    }
    if (small || prev.label === seg.label) {
      prev.to = seg.to
      prev.chars += seg.chars
      continue
    }
    merged.push({ ...seg })
  }
  return merged
}

/**
 * 覆盖率：分段总和是否等于会话总量。
 * @param {Array<{turn:number,user:string,assistant:string}>} items
 * @param {Array<{from:number,to:number,chars:number}>} segs
 */
export function coverage(items, segs) {
  const totalTurns = items.length
  const totalChars = items.reduce((n, i) => n + i.user.length + i.assistant.length, 0)
  const coveredTurns = segs.reduce((n, s) => n + (s.to - s.from + 1), 0)
  const coveredChars = segs.reduce((n, s) => n + s.chars, 0)
  return {
    totalTurns,
    totalChars,
    coveredTurns,
    coveredChars,
    ok: coveredTurns === totalTurns && coveredChars === totalChars,
  }
}
