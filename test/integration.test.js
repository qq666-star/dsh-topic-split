import test from 'node:test'
import assert from 'node:assert/strict'

import { makeHome, makePairs } from './helpers.js'

const home = makeHome()
const { apply } = await import('../src/index.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, resolveSession } = await import('../src/store.js')
const { resolveConfig } = await import('../src/config.js')
const { createTools, __setResolver } = await import('../src/tools.js')

const cfg = resolveConfig()
const log = { debug() {}, info() {}, warn() {}, error() {} }

const registered = []
const fakeCtx = { tools: { register(tool) { registered.push(tool); return () => {} } } }

test('apply 注册 5 个工具且带 timeoutMs', () => {
  apply(fakeCtx)
  const names = registered.map((t) => t.name)
  assert.deepEqual(names.sort(), [
    'session_coverage',
    'session_cut',
    'session_diag',
    'session_export',
    'session_topics',
  ])
  for (const tool of registered) {
    assert.ok(tool.timeoutMs > 0, `${tool.name} 必须有 timeoutMs`)
    assert.equal(tool.parameters.type, 'object')
  }
})

test('工具 render 返回内容块数组（宿主契约）', () => {
  for (const tool of registered) {
    const blocks = tool.output.render({}, '示例输出')
    assert.ok(Array.isArray(blocks), `${tool.name}.render 必须返回数组`)
    assert.equal(blocks.length > 0, true)
    assert.equal(blocks[0].type, 'text')
    assert.equal(typeof blocks[0].text, 'string')
  }
})

test('取消信号生效：已中止的调用直接返回错误', async () => {
  const topic = registered.find((t) => t.name === 'session_topics')
  const out = await topic.execute({ sessionId: 'whatever' }, { signal: { aborted: true } })
  assert.match(out, /错误\[ABORTED\]/)
})

test('session_diag 输出路径、配置与缓存统计', async () => {
  const diag = registered.find((t) => t.name === 'session_diag')
  const out = await diag.execute({})
  assert.match(out, /会话目录/)
  assert.match(out, /缓存统计/)
  assert.match(out, /主题规则/)
  assert.match(out, /session_topics/)
})

test('注册失败不影响宿主（tools 服务缺失）', () => {
  assert.doesNotThrow(() => apply({}))
  assert.doesNotThrow(() => apply({ tools: {} }))
})

test('禁用开关生效', () => {
  const before = registered.length
  process.env.DSH_SESSION_SPLIT_DISABLE = '1'
  apply(fakeCtx)
  delete process.env.DSH_SESSION_SPLIT_DISABLE
  assert.equal(registered.length, before)
})

test.after(() => home.cleanup())
