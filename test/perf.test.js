import test from 'node:test'
import assert from 'node:assert/strict'

import { makeHome } from './helpers.js'

const home = makeHome()
const { createSession } = await import('../src/exporter.js')
const { createSessionReader } = await import('../src/store.js')
const { resolveConfig } = await import('../src/config.js')
const { extractTurns, segment, coverage } = await import('../src/topics.js')

const cfg = resolveConfig()

// 构造 800 轮、每轮约 400 字的会话
const pairs = Array.from({ length: 800 }, (_, i) => [
  `第 ${i} 轮：桌宠语音与美杜莎形象怎么配置`,
  '回复正文'.repeat(100),
])

const made = createSession({ cwd: 'D:\\PERF', pairs })
const reader = createSessionReader(cfg)

test('冷读大文件在预算内（< 3000ms）', () => {
  const t0 = Date.now()
  const { events } = reader(made.file)
  const elapsed = Date.now() - t0
  assert.ok(events.length > 3000, `事件数 ${events.length}`)
  assert.ok(elapsed < 3000, `冷读耗时 ${elapsed}ms 超出预算`)
  console.log(`[perf] 冷读 ${elapsed}ms，事件 ${events.length}`)
})

test('缓存命中（< 20ms）且统计正确', () => {
  const t0 = Date.now()
  reader(made.file)
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 20, `缓存读耗时 ${elapsed}ms`)
  const stats = reader.stats()
  assert.ok(stats.hits >= 1, JSON.stringify(stats))
  console.log(`[perf] 缓存读 ${elapsed}ms，命中 ${stats.hits} 次`)
})

test('分段与覆盖率在预算内（< 1000ms）', () => {
  const { events } = reader(made.file)
  const t0 = Date.now()
  const items = extractTurns(events)
  const segs = segment(items, cfg.topicRules, cfg)
  const cov = coverage(items, segs)
  const elapsed = Date.now() - t0
  assert.equal(cov.ok, true)
  assert.ok(elapsed < 1000, `分段 ${elapsed}ms 超出预算`)
  console.log(`[perf] 分段 ${elapsed}ms，${segs.length} 段，${cov.totalTurns} 轮`)
})

test.after(() => home.cleanup())
