import test from 'node:test'
import assert from 'node:assert/strict'

import { makePairs, makeHome } from './helpers.js'

// DSH_HOME 必须在导入 store 之前设置
const home = makeHome()

const { resolveConfig } = await import('../src/config.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, resolveSession, listSessions } = await import('../src/store.js')
const { createTools, __setResolver, parseRanges } = await import('../src/tools.js')

const cfg = resolveConfig()
const log = { debug() {}, info() {}, warn() {}, error() {} }

__setResolver(resolveSession)
const readSession = createSessionReader(cfg)
const tools = Object.fromEntries(createTools({ cfg, readSession, log }).map((t) => [t.name, t]))

const seeded = createSession({ cwd: 'D:\\TEST-WS', pairs: makePairs(20), title: '测试' })

test('导出会话包含真实头部与注入事件', () => {
  const { events } = readSession(seeded.file)
  const types = events.map((e) => e.type)
  assert.deepEqual(types.slice(0, 4), ['permission/preset', 'sandbox/mode', 'approval/policy', 'session/end-seed'])
  assert.equal(events[0].seq, 0)
  assert.equal(types.filter((t) => t === 'system/message').length, 1)
  assert.equal(types.filter((t) => t === 'agent/inbox/spliced').length, 40)
  const sysIdx = types.indexOf('system/message')
  const userIdx = types.indexOf('user/message')
  assert.ok(sysIdx > 0 && sysIdx < userIdx, 'system/message 必须在首条用户消息之前')
  for (let i = 0; i < events.length; i++) assert.equal(events[i].seq, i, `seq 必须连续：第 ${i} 条`)
})

test('每轮用户消息都有配对的注入记录', () => {
  const { events } = readSession(seeded.file)
  const inserts = events.filter((e) => e.type === 'agent/inbox/spliced' && e.data?.inserted?.length)
  const users = events.filter((e) => e.type === 'user/message')
  assert.equal(inserts.length, users.length)
  for (const ins of inserts) {
    assert.equal(ins.data.inserted[0].role, 'user')
  }
})

test('导出会话后可被列出与读取', () => {
  const list = listSessions()
  assert.ok(list.some((s) => s.dirName === seeded.id))
  const { header, events } = readSession(seeded.file)
  assert.equal(header.id, seeded.id)
  assert.equal(events.filter((e) => e.type === 'turn/start').length, 20)
  assert.equal(events[0].seq, 0)
  const firstTurn = events.find((e) => e.type === 'turn/start')
  assert.equal(firstTurn.data.turn, 1) // turn 必须从 1 开始
})

test('session_topics 输出主题与覆盖率', async () => {
  const out = await tools.session_topics.execute({ sessionId: seeded.id.slice(8, 16) })
  assert.match(out, /主题分段/)
  assert.match(out, /覆盖率：轮次 20\/20/)
  assert.match(out, /一致 ✔/)
})

test('session_export 支持多段合并', async () => {
  const before = listSessions().length
  const out = await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-4,10-14' })
  assert.match(out, /已导出 10 轮/)
  assert.equal(listSessions().length, before + 1)
})

test('session_coverage 对全区間判定一致', async () => {
  const out = await tools.session_coverage.execute({ sessionId: seeded.id, ranges: '0-19' })
  assert.match(out, /一致 ✔/)
})

test('错误路径返回错误码而不是抛出', async () => {
  assert.match(await tools.session_topics.execute({ sessionId: 'nope' }), /错误\[SESSION_NOT_FOUND\]/)
  assert.match(await tools.session_export.execute({ sessionId: seeded.id, ranges: 'abc' }), /错误\[RANGE_INVALID\]/)
  assert.match(await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-999' }), /错误\[RANGE_INVALID\]/)
  assert.match(await tools.session_export.execute({ sessionId: seeded.id, ranges: '9-3' }), /错误\[RANGE_INVALID\]/)
  assert.match(await tools.session_export.execute({ sessionId: seeded.id }), /错误\[RANGE_INVALID\]/)
  const many = Array.from({ length: 60 }, () => '0-0').join(',')
  assert.match(await tools.session_export.execute({ sessionId: seeded.id, ranges: many }), /错误\[RANGE_TOO_MANY\]/)
  assert.match(await tools.session_topics.execute({ sessionId: '../etc' }), /错误\[SESSION_ID_INVALID\]/)
})

test('parseRanges 拒绝越界与倒序，并支持 end', () => {
  assert.throws(() => parseRanges('0-5', 3, cfg), /超出范围/)
  assert.throws(() => parseRanges('5-1', 10, cfg), /起点大于终点/)
  assert.deepEqual(parseRanges('0-1,2-3', 10, cfg), [
    [0, 1],
    [2, 3],
  ])
  assert.deepEqual(parseRanges('2-end', 10, cfg), [[2, 9]])
  assert.deepEqual(parseRanges('8-end', 10, cfg), [[8, 9]])
})

test('并发重复读取命中缓存（同一对象）', () => {
  const a = readSession(seeded.file)
  const b = readSession(seeded.file)
  assert.equal(a, b)
})

test.after(() => home.cleanup())
