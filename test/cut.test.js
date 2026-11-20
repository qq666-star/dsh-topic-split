import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { makeHome } from './helpers.js'

const home = makeHome()

const { resolveConfig } = await import('../src/config.js')
const { createSession } = await import('../src/exporter.js')
const { createRegistrar } = await import('../src/registry.js')
const { createSessionReader, registryPath, resolveSession, listSessions } = await import('../src/store.js')
const { createTools, __setResolver } = await import('../src/tools.js')
const { inRanges, planCut } = await import('../src/cut.js')
const { extractTurns } = await import('../src/topics.js')

const cfg = resolveConfig()
const log = { debug() {}, info() {}, warn() {}, error() {} }
__setResolver(resolveSession)
const readSession = createSessionReader(cfg)
const registrar = createRegistrar({ ctx: null, log })
const tools = Object.fromEntries(createTools({ cfg, readSession, log, registrar }).map((t) => [t.name, t]))

function archivedIds() {
  const file = registryPath()
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))?.global?.archivedSessionIds ?? []
}

function seed(count) {
  return createSession({
    cwd: 'D:\\CUT-WS',
    pairs: Array.from({ length: count }, (_, i) => [`u${i}`, `a${i}`]),
  })
}

test('inRanges 与 planCut 正确划分保留/剪除', () => {
  assert.equal(inRanges(3, [[3, 5]]), true)
  assert.equal(inRanges(6, [[3, 5]]), false)
  const items = Array.from({ length: 10 }, (_, i) => ({ user: `u${i}`, assistant: `a${i}` }))
  const plan = planCut(items, [[3, 5]])
  assert.equal(plan.removedTurns, 3)
  assert.equal(plan.remainingTurns, 7)
  assert.deepEqual(plan.keep.map((k) => k.user), ['u0', 'u1', 'u2', 'u6', 'u7', 'u8', 'u9'])
})

test('session_cut 默认只预览，不写文件', async () => {
  const seeded = seed(10)
  const before = listSessions().length
  const out = await tools.session_cut.execute({ sessionId: seeded.id, ranges: '3-5' })
  assert.match(out, /剪掉 3 轮/)
  assert.match(out, /保留 7 轮/)
  assert.match(out, /预览/)
  assert.equal(listSessions().length, before)
})

test('session_cut 执行后生成只含保留轮次的新会话', async () => {
  const seeded = seed(10)
  const out = await tools.session_cut.execute({ sessionId: seeded.id, ranges: '3-5', dryRun: false })
  assert.match(out, /已重建会话/)
  const id = /已重建会话：(\S+?)（/.exec(out)[1]
  const list = listSessions()
  assert.ok(list.some((s) => s.dirName === id))
  const created = list.find((s) => s.dirName === id)
  const turns = extractTurns(readSession(created.file).events)
  assert.equal(turns.length, 7)
  assert.equal(turns[0].user, 'u0')
  assert.equal(turns[3].user, 'u6')
  assert.ok(turns.every((t) => !['u3', 'u4', 'u5'].includes(t.user)))
})

test('session_cut 不能剪掉整个会话', async () => {
  const seeded = seed(4)
  const out = await tools.session_cut.execute({ sessionId: seeded.id, ranges: '0-3', dryRun: false })
  assert.match(out, /错误\[EMPTY_RESULT\]/)
})

test('archive=true 时原会话被归档，且目录名保持不变', async () => {
  const seeded = seed(6)
  const sourceDir = seeded.file.replace(/\\session\.v4\.jsonl\.zstd$/, '')
  const out = await tools.session_cut.execute({
    sessionId: seeded.id,
    ranges: '1-2',
    dryRun: false,
    archive: true,
  })
  assert.match(out, /原会话已归档/)
  // 归档只登记到 archivedSessionIds：目录必须原地不动，否则 DSH 会话列表会整份读不出来
  assert.equal(fs.existsSync(sourceDir), true)
  assert.equal(listSessions().some((s) => s.dirName === seeded.id), true)
  assert.ok(archivedIds().includes(seeded.id))
})

test('session_export cut=true：导出独立段、重建主会话并归档原会话', async () => {
  const seeded = seed(8)
  const sourceDir = seeded.file.replace(/\\session\.v4\.jsonl\.zstd$/, '')
  const out = await tools.session_export.execute({
    sessionId: seeded.id,
    ranges: '2-4',
    dryRun: false,
    cut: true,
  })
  const ids = [...out.matchAll(/→ (session-[0-9a-f-]+)/g)].map((m) => m[1])
  assert.equal(ids.length, 2, out)
  const list = listSessions()
  // 原会话仍在磁盘且未被改名（归档只是登记）
  assert.equal(list.some((s) => s.dirName === seeded.id), true)
  assert.equal(fs.existsSync(sourceDir), true)
  assert.ok(archivedIds().includes(seeded.id))
  const exported = list.find((s) => s.dirName === ids[0])
  const main = list.find((s) => s.dirName === ids[1])
  assert.ok(exported && main)
  assert.equal(extractTurns(readSession(exported.file).events).length, 3)
  const kept = extractTurns(readSession(main.file).events).map((t) => t.user)
  assert.deepEqual(kept, ['u0', 'u1', 'u5', 'u6', 'u7'])
})

test('session_export cut=true 的 dryRun 会预告剪除', async () => {
  const seeded = seed(6)
  const out = await tools.session_export.execute({
    sessionId: seeded.id,
    ranges: '1-2',
    dryRun: true,
    cut: true,
  })
  assert.match(out, /同时剪除/)
  assert.match(out, /原会话归档/)
})

test.after(() => home.cleanup())
