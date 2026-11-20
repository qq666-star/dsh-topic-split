import test from 'node:test'
import assert from 'node:assert/strict'

const {
  isLoopbackHost,
  isLoopbackOrigin,
  isLoopbackAddress,
  safeEqual,
  readToken,
  resolveHttpToken,
  createRateLimiter,
  createHttpGuard,
  tokenMetaTag,
} = await import('../src/http-auth.js')

test('对端地址只认本机', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }
  for (const address of ['192.168.1.9', '10.0.0.1', '', '::ffff:192.168.1.9']) {
    assert.equal(isLoopbackAddress(address), false, String(address))
  }
})

test('Host 只认本机地址', () => {
  for (const host of ['127.0.0.1:3080', '127.0.0.1', 'localhost:3080', 'LOCALHOST', '[::1]:3080', '::1']) {
    assert.equal(isLoopbackHost(host), true, host)
  }
  for (const host of ['evil.example', 'evil.example:3080', '192.168.1.5:3080', '', undefined]) {
    assert.equal(isLoopbackHost(host), false, String(host))
  }
})

test('Origin 只认本机来源，缺省视为同源', () => {
  assert.equal(isLoopbackOrigin('http://127.0.0.1:3080'), true)
  assert.equal(isLoopbackOrigin('https://localhost:8443'), true)
  assert.equal(isLoopbackOrigin(''), true)
  assert.equal(isLoopbackOrigin(undefined), true)
  assert.equal(isLoopbackOrigin('http://evil.example'), false)
  assert.equal(isLoopbackOrigin('file:///tmp/x'), false)
  assert.equal(isLoopbackOrigin('not a url'), false)
})

test('令牌比较：长度或内容不同都失败，空值不通过', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', ''), false)
  assert.equal(safeEqual(undefined, undefined), false)
})

test('从请求头读取令牌', () => {
  assert.equal(readToken({ headers: { 'x-dsh-split-token': 'tk' } }), 'tk')
  assert.equal(readToken({ headers: { authorization: 'Bearer tk2' } }), 'tk2')
  assert.equal(readToken({ headers: { authorization: 'bearer tk3' } }), 'tk3')
  assert.equal(readToken({ headers: {} }), '')
  assert.equal(readToken({}), '')
})

test('令牌解析：配置优先，其次环境变量，最后随机', () => {
  assert.deepEqual(resolveHttpToken({ httpToken: 'cfg' }), { token: 'cfg', ephemeral: false })

  process.env.DSH_SESSION_SPLIT_HTTP_TOKEN = 'env-token'
  try {
    assert.deepEqual(resolveHttpToken({ httpToken: '' }), { token: 'env-token', ephemeral: false })
  } finally {
    delete process.env.DSH_SESSION_SPLIT_HTTP_TOKEN
  }

  const generated = resolveHttpToken({ httpToken: '' })
  assert.equal(generated.ephemeral, true)
  assert.match(generated.token, /^[0-9a-f]{48}$/)
})

test('限流器按滑动窗口计数', () => {
  let now = 0
  const allow = createRateLimiter(2, () => now)
  assert.equal(allow('k'), true)
  assert.equal(allow('k'), true)
  assert.equal(allow('k'), false)
  assert.equal(allow('other'), true)
  now = 61_000
  assert.equal(allow('k'), true)
})

test('守卫：令牌、Host、Origin 与限流组合生效', () => {
  const cfg = {
    httpToken: 'tk',
    httpRateLimitPerMin: 2,
    httpExportPerMin: 1,
  }
  const guard = createHttpGuard({ cfg, log: { warn() {} } })
  const req = (headers, peer = '127.0.0.1') => ({ headers, socket: { remoteAddress: peer } })

  assert.equal(guard.check(req({ host: '127.0.0.1:3080', 'x-dsh-split-token': 'tk' }), 'general').ok, true)
  assert.equal(guard.check(req({ host: 'evil.example', 'x-dsh-split-token': 'tk' }), 'general').status, 403)
  assert.equal(
    guard.check(req({ host: '127.0.0.1', origin: 'http://evil.example', 'x-dsh-split-token': 'tk' }), 'general')
      .status,
    403,
  )
  assert.equal(guard.check(req({ host: '127.0.0.1', 'x-dsh-split-token': 'bad' }), 'general').status, 401)

  // 跨站标记
  assert.equal(
    guard.check(
      req({ host: '127.0.0.1', 'x-dsh-split-token': 'tk', 'sec-fetch-site': 'cross-site' }),
      'general',
    ).code,
    'CROSS_SITE',
  )
  assert.equal(
    guard.check(
      req({ host: '127.0.0.1', 'x-dsh-split-token': 'tk', 'sec-fetch-site': 'same-origin' }),
      'general',
    ).ok,
    true,
  )

  // 非本机连接
  assert.equal(
    guard.check(req({ host: '127.0.0.1', 'x-dsh-split-token': 'tk' }, '192.168.1.9'), 'general').code,
    'PEER_NOT_ALLOWED',
  )

  const exportReq = {
    headers: { host: '127.0.0.1', 'x-dsh-split-token': 'tk' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(guard.check(exportReq, 'export').ok, true)
  assert.equal(guard.check(exportReq, 'export').status, 429)
})

test('meta 标签会转义内容', () => {
  const tag = tokenMetaTag('a"b<c&d')
  assert.equal(tag, '<meta name="dsh-split-token" content="a&quot;b&lt;c&amp;d">')
})
