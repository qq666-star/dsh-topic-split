import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { makeHome } from './helpers.js'

// DSH_HOME 必须在导入 store 之前设置
const home = makeHome()

const { resolveConfig } = await import('../src/config.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, resolveSession, listSessions } = await import('../src/store.js')
const { createTools, __setResolver } = await import('../src/tools.js')
const { parseTurnSpec, selectionCoverage, selectionFromArgs, selectionFromRanges } = await import(
  '../src/selection.js'
)
const { extractTurns } = await import('../src/topics.js')

const cfg = resolveConfig()
const log = { debug() {}, info() {}, warn() {}, error() {} }

__setResolver(resolveSession)
const readSession = createSessionReader(cfg)
const tools = Object.fromEntries(createTools({ cfg, readSession, log }).map((t) => [t.name, t]))

function seed(count) {
  return createSession({
    cwd: 'D:\\SEL-WS',
    pairs: Array.from({ length: count }, (_, i) => [`u${i}`, `a${i}`]),
  })
}

function hash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const turnsOf = (file) => extractTurns(readSession(file).events)

test('parseTurnSpec 解析单轮与区间，并合并相邻项', () => {
  const sel = parseTurnSpec('3,7-9,20', 100, cfg)
  assert.deepEqual(sel.indices, [3, 7, 8, 9, 20])
  assert.deepEqual(sel.runs, [
    [3, 3],
    [7, 9],
    [20, 20],
  ])
  assert.equal(sel.normalized, false)
})

test('parseTurnSpec 去重并标记规范化', () => {
  const sel = parseTurnSpec('1,1-3,4', 100, cfg)
  assert.deepEqual(sel.indices, [1, 2, 3, 4])
  assert.deepEqual(sel.runs, [[1, 4]])
  assert.equal(sel.normalized, true)
})

test('parseTurnSpec 拒绝非法格式、越界与过多项', () => {
  const code = (fn) => {
    try {
      fn()
    } catch (err) {
      return err.code
    }
    return null
  }
  assert.equal(code(() => parseTurnSpec('', 10, cfg)), 'TURNS_INVALID')
  assert.equal(code(() => parseTurnSpec('abc', 10, cfg)), 'TURNS_INVALID')
  assert.equal(code(() => parseTurnSpec('9-3', 10, cfg)), 'TURNS_INVALID')
  assert.equal(code(() => parseTurnSpec('0-10', 10, cfg)), 'TURNS_INVALID')
  const many = Array.from({ length: cfg.maxRanges + 1 }, () => '0').join(',')
  assert.equal(code(() => parseTurnSpec(many, 10, cfg)), 'RANGE_TOO_MANY')
})

test('selectionFromRanges 合并重叠区间，避免重复计数', () => {
  const sel = selectionFromRanges([
    [0, 5],
    [3, 9],
  ])
  assert.equal(sel.indices.length, 10)
  assert.deepEqual(sel.runs, [[0, 9]])
  assert.equal(sel.normalized, true)
})

test('selectionFromArgs 要求 ranges 与 turns 二选一', () => {
  assert.equal(selectionFromArgs({}, 10, cfg), null)
  assert.throws(
    () => selectionFromArgs({ ranges: '0-1', turns: '2' }, 10, cfg),
    (err) => err.code === 'TURNS_INVALID',
  )
})

test('selectionCoverage 满足「选中 + 排除 = 全部」', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ user: `u${i}`, assistant: `a${i}` }))
  const cov = selectionCoverage(items, [0, 2, 4])
  assert.equal(cov.selectedTurns, 3)
  assert.equal(cov.excludedTurns, 7)
  assert.equal(cov.selectedTurns + cov.excludedTurns, cov.totalTurns)
  assert.equal(cov.selectedChars + cov.excludedChars, cov.totalChars)
  assert.equal(cov.ok, true)
  assert.equal(cov.complete, false)
})

test('session_export 按任意轮次导出，且不修改源会话', async () => {
  const seeded = seed(20)
  const before = hash(seeded.file)
  const count = listSessions().length
  const out = await tools.session_export.execute({ sessionId: seeded.id, turns: '1,5,7-9' })
  assert.match(out, /已导出 5 轮（3 段）/)
  assert.equal(hash(seeded.file), before, '源会话文件不应被改动')
  assert.equal(listSessions().length, count + 1)
  const id = /→ (session-[0-9a-f-]+)/.exec(out)[1]
  const created = listSessions().find((s) => s.dirName === id)
  const turns = turnsOf(created.file)
  assert.deepEqual(turns.map((t) => t.user), ['u1', 'u5', 'u7', 'u8', 'u9'])
  const events = readSession(created.file).events
  assert.deepEqual(events.slice(0, 4).map((e) => e.type), [
    'permission/preset',
    'sandbox/mode',
    'approval/policy',
    'session/end-seed',
  ])
  for (let i = 0; i < events.length; i++) assert.equal(events[i].seq, i)
})

test('session_export 的 turns 预览不写文件', async () => {
  const seeded = seed(20)
  const count = listSessions().length
  const out = await tools.session_export.execute({
    sessionId: seeded.id,
    turns: '1,5,7-9',
    dryRun: true,
  })
  assert.match(out, /预览/)
  assert.match(out, /选中 5 轮/)
  assert.match(out, /3 个连续块/)
  assert.match(out, /排除 15 轮/)
  assert.equal(listSessions().length, count)
  const cutPreview = await tools.session_export.execute({
    sessionId: seeded.id,
    turns: '1,5,7-9',
    dryRun: true,
    cut: true,
  })
  assert.match(cutPreview, /将新建 2 个会话/)
  assert.equal(listSessions().length, count)
})

test('session_cut 按任意轮次剪除，保留其余轮次', async () => {
  const seeded = seed(10)
  const out = await tools.session_cut.execute({
    sessionId: seeded.id,
    turns: '0,2,4',
    dryRun: false,
  })
  assert.match(out, /剪掉 3 轮/)
  assert.match(out, /保留 7 轮/)
  const id = /已重建会话：(\S+?)（/.exec(out)[1]
  const created = listSessions().find((s) => s.dirName === id)
  const users = turnsOf(created.file).map((t) => t.user)
  assert.deepEqual(users, ['u1', 'u3', 'u5', 'u6', 'u7', 'u8', 'u9'])
})

test('session_coverage 支持 turns 与重叠 ranges', async () => {
  const seeded = seed(20)
  const half = await tools.session_coverage.execute({ sessionId: seeded.id, turns: '0-9' })
  assert.match(half, /选中 10 轮/)
  assert.match(half, /排除 10 轮/)
  assert.match(half, /一致 ✔/)
  const overlap = await tools.session_coverage.execute({ sessionId: seeded.id, ranges: '0-5,3-9' })
  assert.match(overlap, /选中 10 轮/)
  assert.match(overlap, /1 个连续块/)
})

test('工具层拒绝 ranges 与 turns 同时出现', async () => {
  const seeded = seed(10)
  const out = await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-1', turns: '2' })
  assert.match(out, /错误\[TURNS_INVALID\]/)
  const cut = await tools.session_cut.execute({ sessionId: seeded.id })
  assert.match(cut, /错误\[RANGE_INVALID\]/)
})

test('导出空选择或全选剪除时给出明确错误', async () => {
  const seeded = seed(6)
  const empty = await tools.session_export.execute({ sessionId: seeded.id, turns: '  ' })
  assert.match(empty, /错误\[RANGE_INVALID\]/)
  const all = await tools.session_cut.execute({ sessionId: seeded.id, turns: '0-5', dryRun: false })
  assert.match(all, /错误\[EMPTY_RESULT\]/)
})

test('ranges 旧路径行为不变', async () => {
  const seeded = seed(20)
  const out = await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-4,10-14' })
  assert.match(out, /已导出 10 轮（2 段）/)
  const cov = await tools.session_coverage.execute({ sessionId: seeded.id, ranges: '0-19' })
  assert.match(cov, /选中 20 轮/)
  assert.match(cov, /选中即全量/)
})

test('session_export cut=true 支持 turns：导出散点、主会话保留其余', async () => {
  const seeded = seed(8)
  const out = await tools.session_export.execute({
    sessionId: seeded.id,
    turns: '2,4-5',
    dryRun: false,
    cut: true,
  })
  const ids = [...out.matchAll(/→ (session-[0-9a-f-]+)/g)].map((m) => m[1])
  assert.equal(ids.length, 2, out)
  const list = listSessions()
  const exported = list.find((s) => s.dirName === ids[0])
  const main = list.find((s) => s.dirName === ids[1])
  assert.deepEqual(turnsOf(exported.file).map((t) => t.user), ['u2', 'u4', 'u5'])
  assert.deepEqual(
    turnsOf(main.file).map((t) => t.user),
    ['u0', 'u1', 'u3', 'u6', 'u7'],
  )
})

test('工具契约：参数根节点为完整 JSON Schema，render 返回内容块数组', () => {
  for (const tool of Object.values(tools)) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} 根节点必须是 object`)
    assert.equal(typeof tool.parameters.properties, 'object', `${tool.name} 缺少 properties`)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.timeoutMs, 'number')
    const blocks = tool.output.render({}, 'x')
    assert.ok(Array.isArray(blocks), `${tool.name} render 必须返回数组`)
    assert.equal(blocks[0].type, 'text')
  }
  assert.ok(tools.session_export.parameters.properties.turns, 'session_export 必须声明 turns')
  assert.equal(tools.session_export.parameters.properties.turns.type, 'string')
})

test.after(() => home.cleanup())
