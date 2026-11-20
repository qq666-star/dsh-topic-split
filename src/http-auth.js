/** HTTP 面板路由的安全层：令牌鉴权、Host/Origin 校验、限流、令牌注入。
 *
 * 背景：插件向 DSH webServer 注册的路由不经过宿主自身的 token 鉴权，
 * 因此必须自己把关，否则任何本机进程（以及可能的 DNS rebinding）都能读取
 * 会话元数据或触发导出。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
/** 客户端携带令牌的请求头。 */
export const TOKEN_HEADER = 'x-dsh-split-token'
/** 服务端注入页面、客户端读取令牌的 meta 名。 */
export const TOKEN_META_NAME = 'dsh-split-token'

/**
 * 判断连接对端地址是否为本机（IPv4/IPv6/映射地址）。
 * @param {unknown} address socket.remoteAddress
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  const raw = String(address ?? '').trim().toLowerCase()
  if (!raw) return false
  if (raw === '::1' || raw === '127.0.0.1') return true
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length) === '127.0.0.1'
  return false
}

/**
 * 判断 Host 头是否为本机地址（允许带端口、IPv6 方括号）。
 * @param {unknown} hostHeader 请求的 Host 头
 * @returns {boolean}
 */
export function isLoopbackHost(hostHeader) {
  const raw = String(hostHeader ?? '').trim().toLowerCase()
  if (!raw) return false
  let host = raw
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end === -1) return false
    host = raw.slice(0, end + 1)
  } else if ((raw.match(/:/g) ?? []).length > 1) {
    // 裸 IPv6（理论少见，Host 头按 RFC 应带方括号）
    host = raw
  } else if (raw.includes(':')) {
    host = raw.slice(0, raw.indexOf(':'))
  }
  return LOOPBACK_HOSTS.has(host.replace(/^\[|\]$/g, ''))
}

/**
 * 判断 Origin 是否为本机来源；缺省 Origin（同源 GET）视为通过。
 * @param {unknown} origin 请求的 Origin 头
 * @returns {boolean}
 */
export function isLoopbackOrigin(origin) {
  const raw = String(origin ?? '').trim()
  if (!raw) return true
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isLoopbackHost(url.host)
  } catch {
    return false
  }
}

/** 常量时间比较，避免逐字符泄露。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

/**
 * 从请求头读取令牌：优先自定义头，其次 Bearer。
 * @param {{headers?: Record<string, unknown>}} req
 * @returns {string}
 */
export function readToken(req) {
  const header = req?.headers?.[TOKEN_HEADER]
  if (typeof header === 'string' && header.trim()) return header.trim()
  const auth = req?.headers?.authorization
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return ''
}

/**
 * 解析令牌：配置 > 环境变量 > 随机生成（随机生成只活在当前进程）。
 * @param {{httpToken?: string}} cfg
 * @param {{warn: Function}} [log]
 * @returns {{token: string, ephemeral: boolean}}
 */
export function resolveHttpToken(cfg, log) {
  const fromConfig = String(cfg?.httpToken ?? '').trim()
  if (fromConfig) return { token: fromConfig, ephemeral: false }
  const fromEnv = String(process.env.DSH_SESSION_SPLIT_HTTP_TOKEN ?? '').trim()
  if (fromEnv) return { token: fromEnv, ephemeral: false }
  const token = randomBytes(24).toString('hex')
  log?.warn('未配置 httpToken，已生成进程内随机令牌（客户端通过页面 meta 自动获取）')
  return { token, ephemeral: true }
}

/**
 * 滑动窗口限流器。
 * @param {number} perMin 每分钟允许次数
 * @param {() => number} [now] 时钟（测试可注入）
 * @returns {(key: string) => boolean} 是否放行
 */
export function createRateLimiter(perMin, now = Date.now) {
  const hits = new Map()
  return function allow(key) {
    const at = now()
    const cutoff = at - 60_000
    const list = (hits.get(key) ?? []).filter((ts) => ts > cutoff)
    if (list.length >= perMin) {
      hits.set(key, list)
      return false
    }
    list.push(at)
    hits.set(key, list)
    if (hits.size > 512) {
      for (const [k, v] of hits) {
        if (v.every((ts) => ts <= cutoff)) hits.delete(k)
      }
    }
    return true
  }
}

/**
 * 创建请求守卫。
 * @param {{cfg: object, log: object}} input
 */
export function createHttpGuard({ cfg, log }) {
  const { token, ephemeral } = resolveHttpToken(cfg, log)
  const general = createRateLimiter(cfg.httpRateLimitPerMin)
  const exporter = createRateLimiter(cfg.httpExportPerMin)

  /**
   * @param {any} req node 请求
   * @param {'general'|'export'} kind 限流档位
   * @returns {{ok: true} | {ok: false, status: number, code: string, message: string}}
   */
  function check(req, kind) {
    if (!isLoopbackHost(req?.headers?.host)) {
      return { ok: false, status: 403, code: 'HOST_NOT_ALLOWED', message: '只允许本机访问' }
    }
    const peerAddress = req?.socket?.remoteAddress
    if (peerAddress && !isLoopbackAddress(peerAddress)) {
      return { ok: false, status: 403, code: 'PEER_NOT_ALLOWED', message: '只允许本机连接' }
    }
    if (!isLoopbackOrigin(req?.headers?.origin)) {
      return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: '来源不被允许' }
    }
    const site = String(req?.headers?.['sec-fetch-site'] ?? '').toLowerCase()
    if (site === 'cross-site' || site === 'same-site') {
      return { ok: false, status: 403, code: 'CROSS_SITE', message: '跨站请求被拒绝' }
    }
    if (!safeEqual(readToken(req), token)) {
      return { ok: false, status: 401, code: 'UNAUTHORIZED', message: '缺少或错误的访问令牌' }
    }
    const peer = String(peerAddress ?? 'local')
    const limiter = kind === 'export' ? exporter : general
    if (!limiter(`${peer}|${kind}`)) {
      return { ok: false, status: 429, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }
    }
    return { ok: true }
  }

  return {
    token,
    ephemeral,
    check,
    describe: () => (ephemeral ? '进程内随机令牌' : '配置令牌'),
  }
}

/** 注入 index.html 的 meta 标签（令牌为十六进制或用户字符串，已转义）。 */
export function tokenMetaTag(token) {
  const escaped = String(token).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<meta name="${TOKEN_META_NAME}" content="${escaped}">`
}
