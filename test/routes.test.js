import test from 'node:test'
import assert from 'node:assert/strict'

import { makeHome, makePairs } from './helpers.js'

const home = makeHome()
const { apply } = await import('../src/index.js')
const { resolveConfig } = await import('../src/config.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, listSessions, resolveSession } = await import('../src/store.js')
const { extractTurns } = await import('../src/topics.js')

const cfg = resolveConfig()
const readSession = createSessionReader(cfg)

const TOKEN = 'unit-token'
const seeded = createSession({ cwd: 'D:\\ROUTE-WS', pairs: makePairs(6) })

/**
 * 造一个可观测的宿主上下文。
 * @param {{cfg?: object}} [options]
 */
function makeHost(options = {}) {
  const routes = []
  const taps = []
  const ctx = {
    tools: {
      register() {
        return () => {}
      },
    },
    get(name) {
      if (name !== 'webServer') return undefined
      return {
        register(route) {
          routes.push(route)
          return () => {}
        },
        tapIndex(fn) {
          taps.push(fn)
          return () => {}
        },
      }
    },
  }
  apply(ctx, options.cfg)
  return { routes, taps, route: routes[0], tap: taps[0] }
}

/** 调用已注册路由，返回 { status, body }。 */
async function call(route, method, url, payload, headers = {}, peer = '127.0.0.1') {
  let status = 200
  let raw = ''
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...headers },
    socket: { remoteAddress: peer },
    [Symbol.asyncIterator]: async function* () {
      if (payload !== undefined) yield Buffer.from(JSON.stringify(payload))
    },
  }
  const res = {
    writeHead(code) {
      status = code
    },
    end(chunk) {
      raw += chunk ?? ''
    },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : null }
}

const authed = { 'x-dsh-split-token': TOKEN }

test('默认开启面板且要求令牌', async () => {
  const host = makeHost()
  assert.equal(host.routes.length, 1)
  assert.equal(host.taps.length, 1)
  const denied = await call(host.route, 'GET', '/dsh-topic-split/sessions')
  assert.equal(denied.status, 401)
})

test('显式 httpRoutes=off 时完全不注册路由', () => {
  const host = makeHost({ cfg: { httpRoutes: 'off' } })
  assert.equal(host.routes.length, 0)
  assert.equal(host.taps.length, 0)
})

test('开启后只注册一个 prefix 路由', () => {
  const host = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  assert.equal(host.routes.length, 1)
  assert.equal(host.routes[0].kind, 'prefix')
  assert.equal(host.routes[0].path, '/dsh-topic-split')
})

test('缺少或错误令牌一律 401', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const missing = await call(route, 'GET', '/dsh-topic-split/sessions')
  assert.equal(missing.status, 401)
  assert.equal(missing.body.code, 'UNAUTHORIZED')

  const wrong = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    'x-dsh-split-token': 'nope',
  })
  assert.equal(wrong.status, 401)

  const bearer = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    authorization: `Bearer ${TOKEN}`,
  })
  assert.equal(bearer.status, 200)
})

test('非本机 Host 与跨站 Origin 被拒绝', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const evilHost = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    ...authed,
    host: 'evil.example',
  })
  assert.equal(evilHost.status, 403)
  assert.equal(evilHost.body.code, 'HOST_NOT_ALLOWED')

  const evilOrigin = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    ...authed,
    origin: 'http://evil.example',
  })
  assert.equal(evilOrigin.status, 403)
  assert.equal(evilOrigin.body.code, 'ORIGIN_NOT_ALLOWED')

  const localOrigin = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    ...authed,
    origin: 'http://127.0.0.1:3080',
  })
  assert.equal(localOrigin.status, 200)
})

test('带令牌可读取会话清单与分段', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const sessions = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, authed)
  assert.equal(sessions.body.ok, true)
  assert.ok(sessions.body.value.some((row) => row.id === seeded.id))
  assert.equal(typeof sessions.body.value[0].turns, 'number')

  const topics = await call(
    route,
    'GET',
    `/dsh-topic-split/topics?sessionId=${seeded.id}&mode=keyword`,
    undefined,
    authed,
  )
  assert.equal(topics.body.ok, true)
  assert.ok(topics.body.value.segments.length >= 1)
  assert.equal(topics.body.value.coverage.ok, true)
})

test('默认返回会话标题，显式关闭则不返回', async () => {
  const shown = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const shownBody = await call(shown.route, 'GET', '/dsh-topic-split/sessions', undefined, authed)
  assert.equal(typeof shownBody.body.value[0].title, 'string')

  const hidden = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN, exposeTitles: false } })
  const hiddenBody = await call(hidden.route, 'GET', '/dsh-topic-split/sessions', undefined, authed)
  assert.equal(Object.hasOwn(hiddenBody.body.value[0], 'title'), false)
})

test('跨站标记与非本机连接被拒绝', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const crossSite = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, {
    ...authed,
    'sec-fetch-site': 'cross-site',
  })
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.body.code, 'CROSS_SITE')

  const remote = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, authed, '192.168.1.9')
  assert.equal(remote.status, 403)
  assert.equal(remote.body.code, 'PEER_NOT_ALLOWED')
})

test('预览与导出都要求令牌，dryRun 不写文件', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const denied = await call(route, 'POST', '/dsh-topic-split/preview', {
    sessionId: seeded.id,
    groups: [{ title: 'A', ranges: '0-1' }],
  })
  assert.equal(denied.status, 401)

  const before = listSessions().length
  const preview = await call(
    route,
    'POST',
    '/dsh-topic-split/preview',
    { sessionId: seeded.id, groups: [{ title: 'A', ranges: '0-1' }] },
    authed,
  )
  assert.equal(preview.body.ok, true)
  assert.equal(preview.body.value.groups[0].turns, 2)

  const dry = await call(
    route,
    'POST',
    '/dsh-topic-split/export',
    { sessionId: seeded.id, groups: [{ title: 'A', ranges: '0-1' }], dryRun: true },
    authed,
  )
  assert.equal(dry.body.ok, true)
  assert.equal(listSessions().length, before)
})

test('带令牌的真正导出会创建会话', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const before = listSessions().length
  const out = await call(
    route,
    'POST',
    '/dsh-topic-split/export',
    { sessionId: seeded.id, groups: [{ title: 'A', ranges: '0-1' }] },
    authed,
  )
  assert.equal(out.body.ok, true)
  assert.equal(out.body.value.created.length, 1)
  assert.equal(listSessions().length, before + 1)
})

test('参数非法返回错误码而不是崩溃', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const bad1 = await call(
    route,
    'POST',
    '/dsh-topic-split/export',
    { sessionId: seeded.id, groups: [] },
    authed,
  )
  assert.equal(bad1.body.ok, false)
  assert.equal(bad1.status, 400)

  const bad2 = await call(
    route,
    'POST',
    '/dsh-topic-split/preview',
    { sessionId: seeded.id, groups: [{ ranges: '999-1000' }] },
    authed,
  )
  assert.equal(bad2.body.ok, false)

  const bad3 = await call(route, 'GET', '/dsh-topic-split/unknown', undefined, authed)
  assert.equal(bad3.status, 404)
})

test('限流：超出每分钟额度返回 429', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN, httpRateLimitPerMin: 2 } })
  assert.equal((await call(route, 'GET', '/dsh-topic-split/sessions', undefined, authed)).status, 200)
  assert.equal((await call(route, 'GET', '/dsh-topic-split/sessions', undefined, authed)).status, 200)
  const limited = await call(route, 'GET', '/dsh-topic-split/sessions', undefined, authed)
  assert.equal(limited.status, 429)
  assert.equal(limited.body.code, 'RATE_LIMITED')
})

test('令牌注入 index.html 的 meta，且重复注入不叠加', () => {
  const { tap } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  assert.equal(typeof tap, 'function')
  const once = tap('<html><head><title>x</title></head><body></body></html>')
  assert.match(once, /<meta name="dsh-split-token" content="unit-token">/)
  const twice = tap(once)
  assert.equal(twice, once)
})

test('有 ctx.inject 时通过动态注入等待 webServer', () => {
  const routes = []
  const taps = []
  const ctx = {
    tools: {
      register() {
        return () => {}
      },
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer'])
      callback({
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
          tapIndex(fn) {
            taps.push(fn)
            return () => {}
          },
        },
      })
    },
  }
  apply(ctx, { httpRoutes: 'token', httpToken: TOKEN })
  assert.equal(routes.length, 1)
  assert.equal(taps.length, 1)
})

test('诊断接口默认脱敏', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const out = await call(route, 'GET', '/dsh-topic-split/diag', undefined, authed)
  assert.equal(out.body.ok, true)
  assert.match(out.body.value.text, /已隐藏/)
  assert.doesNotMatch(out.body.value.text, /C:\\Users\\/i)
})

test('面板接口支持 turns 组与重叠统计', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const out = await call(
    route,
    'POST',
    '/dsh-topic-split/preview',
    {
      sessionId: seeded.id,
      groups: [
        { title: 'A', ranges: '0-3' },
        { title: 'B', turns: '2,4' },
      ],
    },
    authed,
  )
  assert.equal(out.body.ok, true)
  assert.equal(out.body.value.groups[0].turns, 4)
  assert.equal(out.body.value.groups[1].turns, 2)
  assert.equal(out.body.value.groups[1].source, 'turns')
  assert.deepEqual(out.body.value.groups[1].ranges, [[2, 2], [4, 4]])
  assert.equal(out.body.value.coverage.duplicateTurns, 1)
  assert.equal(out.body.value.coverage.coveredTurns, 5)
  assert.equal(out.body.value.coverage.complete, false)

  const withCut = await call(
    route,
    'POST',
    '/dsh-topic-split/preview',
    {
      sessionId: seeded.id,
      groups: [{ title: 'A', ranges: '0-3' }],
      cut: true,
    },
    authed,
  )
  assert.equal(withCut.body.value.cut.remainingTurns, 2)
  assert.equal(withCut.body.value.cut.archive, true)
})

test('面板导出支持 turns，并可按 cut 重建主会话', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const before = listSessions().length
  const out = await call(
    route,
    'POST',
    '/dsh-topic-split/export',
    { sessionId: seeded.id, groups: [{ title: 'A', turns: '1,3-4' }], cut: true },
    authed,
  )
  assert.equal(out.body.ok, true)
  assert.equal(out.body.value.created.length, 1)
  assert.equal(typeof out.body.value.main, 'string')
  assert.equal(out.body.value.archived, true)
  assert.equal(listSessions().length, before + 2)
  const main = listSessions().find((s) => s.dirName === out.body.value.main)
  assert.ok(main)
  const users = extractTurns(readSession(main.file).events).map((t) => t.user)
  assert.equal(users.length, 3)
  assert.equal(users.join(','), '第 0 轮：桌宠语音怎么配置,第 2 轮：桌宠语音怎么配置,第 5 轮：桌宠语音怎么配置')
  assert.ok(resolveSession(out.body.value.created[0]))
})

test('面板导出拒绝无法识别的组', async () => {
  const { route } = makeHost({ cfg: { httpRoutes: 'token', httpToken: TOKEN } })
  const out = await call(
    route,
    'POST',
    '/dsh-topic-split/preview',
    { sessionId: seeded.id, groups: [{ title: 'empty' }] },
    authed,
  )
  assert.equal(out.body.ok, false)
  assert.equal(out.status, 400)
})

test.after(() => home.cleanup())
