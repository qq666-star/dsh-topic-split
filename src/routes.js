/**
 * HTTP 路由：让客户端面板能真正触发分段与导出（而不是只靠对话调工具）。
 *
 *   GET  /dsh-topic-split/sessions              会话列表（id + 标题 + 轮次）
 *   GET  /dsh-topic-split/topics?sessionId=..&mode=auto|model|keyword
 *   POST /dsh-topic-split/preview  { sessionId, groups: [{title, ranges}] }
 *   POST /dsh-topic-split/export   { sessionId, groups: [{title, ranges}], dryRun? }
 *   GET  /dsh-topic-split/diag
 *
 * 安全（v0.6）：
 * - 默认关闭（httpRoutes: 'off'），只注册工具，不暴露任何 HTTP 接口；
 * - 开启后要求令牌（配置/环境变量，或进程内随机并注入页面 meta）；
 * - 校验 Host / Origin，只允许本机来源，防 DNS rebinding 与跨站请求；
 * - 限流：普通请求与导出请求分档；
 * - 会话标题默认隐藏，诊断信息默认脱敏；
 * - 只读源会话；导出走 store 的原子写；参数全部白名单校验。
 */
import { buildDiagnostics } from './diagnostics.js'
import { ERR, SessionSplitError } from './errors.js'
import { createSession } from './exporter.js'
import { createHttpGuard, tokenMetaTag } from './http-auth.js'
import { listSessions, resolveSession } from './store.js'
import { selectionFromArgs } from './selection.js'
import { coverage, extractTurns } from './topics.js'
import { createResolveTopics } from './tools.js'

const PREFIX = '/dsh-topic-split'
const MAX_GROUPS = 10

function json(res, payload, status = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function fail(res, err, status = 400) {
  const split =
    err instanceof SessionSplitError
      ? err
      : new SessionSplitError(ERR.IO_FAILED, String(err?.message ?? err))
  json(res, { ok: false, error: split.message, code: split.code }, status)
}

/** 从请求体读取 JSON（带大小上限）。 */
async function readBody(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new SessionSplitError(ERR.RANGE_INVALID, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** 会话标题（优先 session/title 事件）。 */
function titleOf(events, fallback) {
  const hit = events.find((e) => e.type === 'session/title')
  return hit?.data?.title ?? fallback
}

/** 解析 webServer 服务：属性直取与 ctx.get 双路径。 */
function resolveWebServer(ctx) {
  if (!ctx) return null
  try {
    const direct = ctx.webServer
    if (direct && typeof direct.register === 'function') return direct
  } catch {
    /* 未注入时可能抛错，继续尝试 ctx.get */
  }
  try {
    const got = typeof ctx.get === 'function' ? ctx.get('webServer') : null
    if (got && typeof got.register === 'function') return got
  } catch {
    /* 忽略 */
  }
  return null
}

/**
 * 注册路由（默认关闭）。
 * @param {any} ctx cordis 上下文
 * @param {object} deps 依赖（cfg / readSession / log / getToolNames / judge / registrar）
 * @returns {boolean} 是否注册成功
 */
export function registerRoutes(ctx, deps) {
  const { cfg, readSession, log, getToolNames, judge, registrar } = deps
  if (cfg.httpRoutes !== 'token') {
    log.info('HTTP 面板路由已关闭（httpRoutes=off）；工具仍可用')
    return null
  }
  const webserver = resolveWebServer(ctx)
  if (!webserver) {
    log.warn('没有 webServer 服务，跳过 HTTP 路由（工具仍可用）')
    return null
  }

  const resolveTopics = createResolveTopics({ cfg, log, judge })
  const guard = createHttpGuard({ cfg, log })
  /** 收集路由与页面注入的释放函数，插件卸载时统一清理。 */
  const disposers = []

  const routeDisposer = webserver.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      const kind = path === `${PREFIX}/export` ? 'export' : 'general'
      const verdict = guard.check(req, kind)
      if (!verdict.ok) {
        json(res, { ok: false, error: verdict.message, code: verdict.code }, verdict.status)
        return
      }
      try {
        if (req.method === 'GET' && (path === `${PREFIX}/sessions` || path === `${PREFIX}/sessions/`)) {
          const rows = listSessions()
            .slice(0, 50)
            .map((s) => {
              let turns = -1
              let title = s.dirName
              try {
                const parsed = readSession(s.file)
                turns = extractTurns(parsed.events).length
                title = titleOf(parsed.events, title)
              } catch {
                turns = -1
              }
              const row = { id: s.dirName, turns, size: s.size, mtime: s.mtime }
              if (cfg.exposeTitles) row.title = title
              return row
            })
          json(res, { ok: true, value: rows })
          return
        }

        if (req.method === 'GET' && path.startsWith(`${PREFIX}/topics`)) {
          const sessionId = url.searchParams.get('sessionId') ?? ''
          const mode = url.searchParams.get('mode') ?? 'auto'
          const session = resolveSession(sessionId)
          const { events } = readSession(session.file)
          const items = extractTurns(events)
          const { segs, note } = await resolveTopics(items, mode, undefined)
          const cov = coverage(items, segs)
          json(res, {
            ok: true,
            value: {
              sessionId: session.dirName,
              turns: items.length,
              segments: segs.map((s) => ({ label: s.label, from: s.from, to: s.to, chars: s.chars })),
              coverage: cov,
              note: note ?? null,
            },
          })
          return
        }

        if (req.method === 'POST' && path === `${PREFIX}/preview`) {
          const body = await readBody(req)
          json(res, { ok: true, value: preview(cfg, readSession, body) })
          return
        }

        if (req.method === 'POST' && path === `${PREFIX}/export`) {
          const body = await readBody(req)
          const plan = preview(cfg, readSession, body)
          if (body.dryRun === true) {
            json(res, { ok: true, value: { dryRun: true, plan } })
            return
          }
          const session = resolveSession(body.sessionId)
          const { header, events } = readSession(session.file)
          const items = extractTurns(events)
          const cwd = header.cwd ?? process.cwd()
          const made = []
          const union = new Set()
          for (const [index, group] of plan.groups.entries()) {
            const selection = groupSelection(cfg, items, body.groups[index])
            for (const i of selection.indices) union.add(i)
            const pairs = selection.indices.map((i) => [items[i].user, items[i].assistant])
            const created = createSession({ cwd, pairs, title: group.title })
            if (registrar) await registrar.register(cwd, created.id)
            made.push(created.id)
          }
          let main = null
          let archived = null
          if (body.cut === true) {
            const keep = []
            items.forEach((item, i) => {
              if (!union.has(i)) keep.push([item.user, item.assistant])
            })
            if (keep.length === 0) {
              throw new SessionSplitError(ERR.EMPTY_RESULT, '剪除后主会话为空，已拒绝执行')
            }
            const createdMain = createSession({
              cwd,
              pairs: keep,
              title: `${body.title ?? '主会话'}（已剪除独立段）`,
            })
            if (registrar) await registrar.register(cwd, createdMain.id)
            main = createdMain.id
            if (registrar) {
              try {
                await registrar.archive(cwd, session.dirName)
                archived = true
              } catch (err) {
                archived = false
                log.warn('归档原会话失败：', err?.message ?? err)
              }
            }
          }
          log.info('HTTP 导出完成', {
            from: session.dirName,
            count: made.length,
            cut: body.cut === true,
          })
          json(res, { ok: true, value: { created: made, main, archived } })
          return
        }

        if (req.method === 'GET' && path === `${PREFIX}/diag`) {
          json(res, {
            ok: true,
            value: {
              text: buildDiagnostics({
                cfg,
                readerStats: () => readSession.stats?.(),
                toolNames: getToolNames ? getToolNames() : [],
                redact: true,
              }),
              judge: judge ? judge.describe?.() ?? judge.kind ?? 'unknown' : '不可用',
              http: guard.describe(),
            },
          })
          return
        }

        fail(res, new SessionSplitError(ERR.RANGE_INVALID, '未知路由: ' + path), 404)
      } catch (err) {
        fail(res, err)
      }
    },
  })
  if (typeof routeDisposer === 'function') disposers.push(routeDisposer)

  // 把令牌注入 index.html：页面只能在通过宿主鉴权后拿到，客户端自动读取
  try {
    if (typeof webserver.tapIndex === 'function') {
      const tapDisposer = webserver.tapIndex((html) =>
        String(html).includes(`name="dsh-split-token"`)
          ? html
          : String(html).replace('</head>', `${tokenMetaTag(guard.token)}</head>`),
      )
      if (typeof tapDisposer === 'function') disposers.push(tapDisposer)
      log.info('访问令牌已注入页面 meta（客户端自动使用）')
    } else {
      log.warn('webServer 不支持 tapIndex：客户端需手动在 localStorage 设置 dsh-split-token')
    }
  } catch (err) {
    log.warn('令牌注入失败：', err && err.message ? err.message : err)
  }

  log.info('HTTP 路由已注册（需令牌）: ' + PREFIX)
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        /* 释放失败不影响卸载流程 */
      }
    }
  }
}

/** 单组轮次选择：ranges 或 turns 二选一。 */
function groupSelection(cfg, items, group) {
  const selection = selectionFromArgs(
    { ranges: group?.ranges, turns: group?.turns },
    items.length,
    cfg,
  )
  if (!selection) {
    throw new SessionSplitError(ERR.RANGE_INVALID, '每个导出组需要 ranges 或 turns')
  }
  return selection
}

/** 统计一组选中轮次的字数。 */
function charsOf(items, indices) {
  let chars = 0
  for (const i of indices) chars += items[i].user.length + items[i].assistant.length
  return chars
}

/** 校验并展开分组计划（供 preview 与 export 共用）。 */
function preview(cfg, readSession, body) {
  const session = resolveSession(body.sessionId)
  const { events } = readSession(session.file)
  const items = extractTurns(events)
  const groups = Array.isArray(body.groups) ? body.groups : []
  if (groups.length === 0) throw new SessionSplitError(ERR.RANGE_INVALID, '至少需要一个导出组')
  if (groups.length > MAX_GROUPS) throw new SessionSplitError(ERR.RANGE_TOO_MANY, `最多 ${MAX_GROUPS} 组`)
  const out = []
  const union = new Set()
  let duplicateTurns = 0
  for (const [index, group] of groups.entries()) {
    const selection = groupSelection(cfg, items, group)
    for (const i of selection.indices) {
      if (union.has(i)) duplicateTurns += 1
      union.add(i)
    }
    out.push({
      title: String(group.title ?? `独立会话 ${index + 1}`),
      source: selection.source,
      ranges: selection.runs,
      turns: selection.indices.length,
      chars: charsOf(items, selection.indices),
    })
  }
  const cutInfo =
    body.cut === true
      ? {
          remainingTurns: items.length - union.size,
          remainingChars: items.reduce(
            (sum, item, i) => (union.has(i) ? sum : sum + item.user.length + item.assistant.length),
            0,
          ),
          archive: true,
        }
      : null
  return {
    sessionId: session.dirName,
    totalTurns: items.length,
    groups: out,
    coverage: {
      coveredTurns: union.size,
      totalTurns: items.length,
      complete: union.size === items.length,
      duplicateTurns,
    },
    cut: cutInfo,
  }
}
