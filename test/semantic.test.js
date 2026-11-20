import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import { makeHome } from './helpers.js'

// DSH_HOME 必须在导入 store 之前设置
const home = makeHome()

const { resolveConfig } = await import('../src/config.js')
const { buildPrompt, createJudge, parseJudgeOutput, validateSegments } = await import('../src/judge.js')
const { segmentByModel, smoothSegments } = await import('../src/semantic.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, resolveSession, listSessions } = await import('../src/store.js')
const { createTools, __setResolver } = await import('../src/tools.js')

const log = { debug() {}, info() {}, warn() {}, error() {} }

function itemsOf(count) {
  return Array.from({ length: count }, (_, i) => ({
    turn: i,
    user: `第 ${i} 轮：桌宠语音怎么配`,
    assistant: `回复 ${i}：${'内容'.repeat(20)}`,
  }))
}

function validReply(count) {
  const half = Math.floor(count / 2)
  return JSON.stringify({
    segments: [
      { label: '前半', from: 0, to: half - 1 },
      { label: '后半', from: half, to: count - 1 },
    ],
  })
}

function stubJudge(reply) {
  const state = { calls: 0 }
  return {
    kind: 'stub',
    describe: () => 'stub',
    get calls() {
      return state.calls
    },
    async complete() {
      state.calls += 1
      return typeof reply === 'function' ? reply(state.calls) : reply
    },
  }
}

const modelCfg = resolveConfig({ minSegmentTurns: 1, minSegmentChars: 1, semantic: { retries: 1, timeoutMs: 2000 } })

test('提示词包含全部轮次编号且按预算截断', () => {
  const items = itemsOf(12)
  const prompt = buildPrompt(items, modelCfg)
  assert.match(prompt, /共有 12 轮/)
  for (let i = 0; i < 12; i++) assert.match(prompt, new RegExp(`#${i} 用户：`))
  const tiny = resolveConfig({ semantic: { summaryChars: 20 } })
  const short = buildPrompt(items, tiny)
  const line = short.split('\n').find((l) => l.startsWith('#3 '))
  assert.ok(line.length < 60, `摘要行应被截断，实际 ${line.length}`)
})

test('校验分段：连续、不重叠、全覆盖', () => {
  const ok = validateSegments(
    { segments: [{ label: 'A', from: 0, to: 9 }, { label: 'B', from: 10, to: 19 }] },
    20,
    modelCfg,
  )
  assert.deepEqual(ok.map((s) => [s.from, s.to]), [[0, 9], [10, 19]])
  assert.throws(() => validateSegments({ segments: [{ label: 'A', from: 1, to: 19 }] }, 20, modelCfg), /应从 0 开始/)
  assert.throws(() => validateSegments({ segments: [{ label: 'A', from: 0, to: 9 }] }, 20, modelCfg), /只覆盖到 10/)
  assert.throws(() => validateSegments({ segments: [{ label: 'A', from: 0, to: 25 }] }, 20, modelCfg), /超出范围/)
  assert.throws(() => validateSegments({ segments: [] }, 20, modelCfg), /缺少 segments/)
  assert.throws(() => validateSegments({ nope: 1 }, 20, modelCfg), /缺少 segments/)
  assert.throws(() => validateSegments({ segments: [{ from: 0, to: 19 }] }, 20, modelCfg), /没有主题名/)
})

test('解析带 Markdown 代码块的回复', () => {
  const text = '```json\n{"segments":[{"label":"只有一段","from":0,"to":19}]}\n```'
  const segs = parseJudgeOutput(text, 20, modelCfg)
  assert.equal(segs.length, 1)
  assert.equal(segs[0].label, '只有一段')
  assert.throws(() => parseJudgeOutput('不是 JSON', 20, modelCfg), /不是合法 JSON/)
})

test('模型分段返回字数并保持覆盖', () => {
  const items = itemsOf(20)
  return segmentByModel(items, stubJudge(validReply(20)), modelCfg).then((segs) => {
    assert.equal(segs.length, 2)
    const total = items.reduce((n, i) => n + i.user.length + i.assistant.length, 0)
    assert.equal(segs.reduce((n, s) => n + s.chars, 0), total)
    assert.equal(segs[0].from, 0)
    assert.equal(segs[1].to, 19)
  })
})

test('模型输出两轮都非法时抛 JUDGE_BAD_OUTPUT', async () => {
  const judge = stubJudge('{"segments":[{"label":"A","from":0,"to":5}]}')
  await assert.rejects(() => segmentByModel(itemsOf(20), judge, modelCfg), /JUDGE_BAD_OUTPUT|只覆盖到/)
  assert.equal(judge.calls, 2, '应重试一次')
})

test('过短的段并入前一段', () => {
  const big = Array.from({ length: 30 }, (_, i) => ({
    turn: i,
    user: `第 ${i} 轮`,
    assistant: '内容'.repeat(200),
  }))
  const segs = smoothSegments(
    big,
    [
      { label: 'A', from: 0, to: 9 },
      { label: 'B', from: 10, to: 11 },
      { label: 'C', from: 12, to: 29 },
    ],
    resolveConfig(),
  )
  assert.deepEqual(segs.map((s) => s.label), ['A', 'C'])
  assert.equal(segs[0].to, 11)
})

test('createJudge：off 返回 null，http 缺 URL 返回 null', () => {
  assert.equal(createJudge({ cfg: resolveConfig({ semantic: { backend: 'off' } }), log, ctx: null }), null)
  const cfgHttp = resolveConfig({ semantic: { backend: 'http' } })
  assert.equal(createJudge({ cfg: cfgHttp, log, ctx: null }), null)
  const cfgKernel = resolveConfig({ semantic: { backend: 'kernel' } })
  assert.equal(createJudge({ cfg: cfgKernel, log, ctx: null }), null)
})

test('createJudge：可通过 ctx.get 拿到 llm 服务', () => {
  const fake = { prepareCall: async () => ({ config: {}, stream: async function* () {} }) }
  const cfg = resolveConfig({ semantic: { backend: 'kernel' } })
  const judge = createJudge({ cfg, log, ctx: { get: (name) => (name === 'llm' ? fake : null) } })
  assert.ok(judge)
  assert.equal(judge.kind, 'kernel')
  assert.match(judge.describe(), /deepseek-official/)
})

test('kernel 后端：块结束文本与错误 finish 都能处理', async () => {
  const ctxWith = (chunks) => ({
    get: (name) =>
      name === 'llm'
        ? {
            prepareCall: async () => ({
              config: {},
              stream: async function* () {
                for (const chunk of chunks) yield chunk
              },
            }),
          }
        : null,
  })
  const cfg = resolveConfig({ semantic: { backend: 'kernel' } })

  const block = createJudge({
    cfg,
    log,
    ctx: ctxWith([{ type: 'block-end', index: 0, block: { type: 'text', text: '{"segments":[]}' } }]),
  })
  assert.equal(await block.complete('p'), '{"segments":[]}')

  const delta = createJudge({
    cfg,
    log,
    ctx: ctxWith([
      { type: 'text-delta', index: 0, text: '半' },
      { type: 'text-delta', index: 0, text: '段' },
    ]),
  })
  assert.equal(await delta.complete('p'), '半段')

  const failed = createJudge({
    cfg,
    log,
    ctx: ctxWith([{ type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } }]),
  })
  await assert.rejects(() => failed.complete('p'), /boom/)
})

test('HTTP 后端能取回 JSON 文本', async () => {
  const reply = validReply(20)
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      assert.match(body, /segments/)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  try {
    const cfg = resolveConfig({
      semantic: { backend: 'http', httpBaseUrl: `http://127.0.0.1:${port}`, httpModel: 'x' },
    })
    const judge = createJudge({ cfg, log, ctx: null })
    assert.ok(judge)
    const text = await judge.complete('hi')
    assert.equal(text, reply)
  } finally {
    await new Promise((done) => server.close(done))
  }
})

test('HTTP 后端对错误状态码报 JUDGE_UNAVAILABLE', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500)
    res.end('boom')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  try {
    const cfg = resolveConfig({
      semantic: { backend: 'http', httpBaseUrl: `http://127.0.0.1:${port}`, httpModel: 'x' },
    })
    const judge = createJudge({ cfg, log, ctx: null })
    await assert.rejects(() => judge.complete('hi'), /JUDGE_UNAVAILABLE|HTTP 500/)
  } finally {
    await new Promise((done) => server.close(done))
  }
})

test('配置校验：非法 backend 抛 CONFIG_INVALID', () => {
  assert.throws(() => resolveConfig({ semantic: { backend: 'bogus' } }), /semantic\.backend/)
  assert.throws(() => resolveConfig({ semantic: { retries: 9 } }), /semantic\.retries/)
  assert.equal(resolveConfig({ semantic: { summaryChars: 60 } }).semantic.summaryChars, 60)
})

test('工具层：keyword 模式不调模型，model 模式无模型时报错', async () => {
  __setResolver(resolveSession)
  const readSession = createSessionReader(modelCfg)
  const seeded = createSession({ cwd: 'D:\\TEST-WS', pairs: Array.from({ length: 20 }, (_, i) => [`u${i}`, `a${i}`]) })
  const judge = stubJudge(validReply(20))
  const tools = Object.fromEntries(
    createTools({ cfg: modelCfg, readSession, log, judge }).map((t) => [t.name, t]),
  )

  const kw = await tools.session_topics.execute({ sessionId: seeded.id, mode: 'keyword' })
  assert.match(kw, /关键词规则/)
  assert.equal(judge.calls, 0)

  const auto = await tools.session_topics.execute({ sessionId: seeded.id })
  assert.match(auto, /判断模型：stub/)
  assert.match(auto, /一致 ✔/)

  const plain = Object.fromEntries(
    createTools({ cfg: modelCfg, readSession, log, judge: null }).map((t) => [t.name, t]),
  )
  const out = await plain.session_topics.execute({ sessionId: seeded.id, mode: 'model' })
  assert.match(out, /错误\[JUDGE_UNAVAILABLE\]/)
})

test('dryRun 只预览不写文件', async () => {
  __setResolver(resolveSession)
  const readSession = createSessionReader(modelCfg)
  const seeded = createSession({ cwd: 'D:\\TEST-WS', pairs: Array.from({ length: 20 }, (_, i) => [`u${i}`, `a${i}`]) })
  const judge = stubJudge(validReply(20))
  const tools = Object.fromEntries(
    createTools({ cfg: modelCfg, readSession, log, judge }).map((t) => [t.name, t]),
  )
  const before = listSessions().length

  const ranged = await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-9', dryRun: true })
  assert.match(ranged, /预览/)
  assert.match(ranged, /将新建 1 个会话/)
  assert.equal(listSessions().length, before)

  const planned = await tools.session_export.execute({ sessionId: seeded.id, dryRun: true })
  assert.match(planned, /未写入/)
  assert.match(planned, /将新建 2 个会话/)
  assert.equal(listSessions().length, before)

  const written = await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-9' })
  assert.match(written, /已导出 10 轮/)
  assert.equal(listSessions().length, before + 1)
})

test.after(() => home.cleanup())
