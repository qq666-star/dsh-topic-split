import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULTS, resolveConfig } from '../src/config.js'
import { coverage, extractTurns, segment } from '../src/topics.js'

const cfg = resolveConfig()
const rules = cfg.topicRules

function eventsFrom(pairs) {
  const events = []
  for (const [i, [user, assistant]] of pairs.entries()) {
    events.push({ type: 'turn/start', seq: events.length, data: { turn: i + 1 } })
    events.push({ type: 'user/message', seq: events.length, data: { content: [{ type: 'text', text: user }] } })
    events.push({
      type: 'assistant/message',
      seq: events.length,
      data: { message: { content: [{ type: 'text', text: assistant }] } },
    })
  }
  return events
}

test('extractTurns 按 turn/start 分组', () => {
  const pairs = [
    ['桌宠语音怎么弄', '先装依赖'],
    ['参赛方案怎么写', '分四份'],
  ]
  const items = extractTurns(eventsFrom(pairs))
  assert.equal(items.length, 2)
  assert.equal(items[0].turn, 0)
  assert.match(items[0].user, /桌宠/)
  assert.match(items[1].assistant, /四份/)
})

test('segment 覆盖全部轮次与字数（无丢失）', () => {
  const pairs = []
  for (let i = 0; i < 30; i++) {
    pairs.push(i < 15 ? [`第${i}轮 桌宠美杜莎`, '回复'.repeat(60)] : [`第${i}轮 参赛方案`, '回复'.repeat(60)])
  }
  const items = extractTurns(eventsFrom(pairs))
  const segs = segment(items, rules, cfg)
  assert.ok(segs.length >= 1)
  assert.equal(segs[0].from, 0)
  assert.equal(segs.at(-1).to, items.length - 1)
  const cov = coverage(items, segs)
  assert.equal(cov.ok, true, JSON.stringify(cov))
  assert.equal(cov.coveredChars, cov.totalChars)
})

test('短段会被并入相邻段', () => {
  const pairs = [
    ['桌宠语音', 'x'.repeat(100)],
    ['桌宠语音', 'x'.repeat(100)],
    ['参赛', 'x'.repeat(100)],
    ['桌宠语音', 'x'.repeat(100)],
    ['桌宠语音', 'x'.repeat(100)],
  ]
  const items = extractTurns(eventsFrom(pairs))
  const segs = segment(items, rules, { ...cfg, minSegmentTurns: 3, minSegmentChars: 10_000 })
  assert.equal(coverage(items, segs).ok, true)
  assert.ok(segs.length <= 2, `应被平滑到 ≤2 段，实际 ${segs.length}`)
})

test('配置校验：非法数值抛 CONFIG_INVALID', () => {
  assert.throws(() => resolveConfig({ maxRanges: 0 }), /CONFIG_INVALID|非法/)
  assert.throws(() => resolveConfig({ topics: [] }), /topics|CONFIG_INVALID/)
  assert.throws(() => resolveConfig({ topics: [['坏正则', '([']] }), /无法编译正则|CONFIG_INVALID/)
})

test('配置校验：自定义主题生效', () => {
  const custom = resolveConfig({ topics: [['测试主题', '测试']] })
  const items = extractTurns(eventsFrom([['测试一下', '收到']]))
  const segs = segment(items, custom.topicRules, custom)
  assert.equal(segs[0].label, '测试主题')
})

test('默认配置自洽', () => {
  const resolved = resolveConfig()
  assert.ok(resolved.topicRules.length === DEFAULTS.topics.length)
  assert.ok(resolved.maxInflatedBytes >= resolved.maxCompressedBytes)
})
