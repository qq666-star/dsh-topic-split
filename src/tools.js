/** 工具定义：输入→输出尽量纯粹，异常统一转成文本（不抛出，避免打断 agent 轮次）。 */
import { ERR, SessionSplitError, asSplitError } from './errors.js'
import { planCut, toPairs } from './cut.js'
import { buildDiagnostics } from './diagnostics.js'
import { createSession } from './exporter.js'
import { describeRuns, parseRanges, selectionCoverage, selectionFromArgs } from './selection.js'
import { segmentByModel } from './semantic.js'
import { coverage, extractTurns, segment } from './topics.js'

// 兼容旧引用：routes.js 与既有测试从 tools.js 取 parseRanges
export { parseRanges }

/** JSON Schema 构造（DSH 要求根节点必须是完整 schema）。 */
function schema(properties, required = []) {
  const out = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) out.required = required
  return out
}

const str = (description) => ({ type: 'string', description })
const bool = (description) => ({ type: 'boolean', description })
const MODES = ['auto', 'model', 'keyword']

/** 千分位，便于人读。 */
function fmt(n) {
  return Number(n).toLocaleString('en-US')
}

/** 把 handler 包成统一形状：抛异常 → 返回 "错误[CODE]：说明"。 */
const TOOL_TIMEOUT_MS = 60_000

function defineTool({ name, description, parameters, handler }) {
  return {
    name,
    description,
    parameters,
    timeoutMs: TOOL_TIMEOUT_MS,
    // 宿主期望 render 返回内容块数组（[{type:'text', text}]），不是裸字符串
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    async execute(args, exec) {
      try {
        if (exec?.signal?.aborted) return `错误[ABORTED]：调用已取消`
        return String(await handler(args ?? {}, exec))
      } catch (err) {
        const split = asSplitError(err)
        return `错误[${split.code}]：${split.message}`
      }
    },
  }
}

/**
 * 创建全部工具定义。
 * @param {object} deps 依赖注入
 * @param {ReturnType<typeof import('./config.js').resolveConfig>} deps.cfg 已校验配置
 * @param {(file: string) => { header: object, events: object[] }} deps.readSession 会话读取器
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} deps.log 日志器
 * @param {() => string[]} [deps.getToolNames] 工具名读取器（诊断用）
 * @param {object|null} [deps.judge] 判断模型（不可用为 null）
 */
/**
 * 创建分段解析器：auto/model 优先用判断模型，失败按需回退关键词。
 * @param {{cfg: object, log: object, judge: object|null}} deps
 */
export function createResolveTopics({ cfg, log, judge }) {
  /**
   * 解析分段：按 mode 决定用模型还是关键词；auto 模式下模型失败自动回退。
   * @param {Array<{turn:number,user:string,assistant:string}>} items
   * @param {string} mode auto | model | keyword
   * @param {{signal?:AbortSignal}} [exec]
   */
  return async function resolveTopics(items, mode, exec) {
    const useModel = mode === 'model' || mode === 'auto'
    if (useModel && judge) {
      try {
        const segs = await segmentByModel(items, judge, cfg, exec?.signal)
        return { segs, note: `判断模型：${judge.describe()}` }
      } catch (err) {
        const split = asSplitError(err)
        if (mode === 'model') throw split
        log.warn('模型分段失败，回退关键词', { code: split.code })
        return {
          segs: segment(items, cfg.topicRules, cfg),
          note: `关键词（模型分段失败：${split.code}，已回退）`,
        }
      }
    }
    if (mode === 'model') {
      throw new SessionSplitError(ERR.JUDGE_UNAVAILABLE, '没有可用的判断模型（检查配置或 DSH_SESSION_SPLIT_JUDGE）')
    }
    return { segs: segment(items, cfg.topicRules, cfg), note: '关键词规则' }
  }
}

/**
 * 创建全部工具定义。
 * @param {object} deps
 * @param {object} deps.cfg 已校验配置
 * @param {Function} deps.readSession 会话读取器
 * @param {object} deps.log 日志器
 * @param {object|null} deps.judge 判断模型
 * @param {Function} [deps.getToolNames] 工具名读取器
 * @param {{register: Function, unregister: Function, archive: Function}|null} [deps.registrar] 会话登记器
 */
export function createTools({ cfg, readSession, log, getToolNames, judge, registrar }) {
  const resolveTopics = createResolveTopics({ cfg, log, judge })
  /** 登记新会话：服务优先，失败回退文件。 */
  const registerNew = async (cwd, id) => {
    if (registrar) await registrar.register(cwd, id)
  }
  /**
   * 归档原会话：只登记归档集合，绝不重命名目录（改名会让 DSH 的会话列表整份读不出来）。
   * @param {string} cwd 工作目录
   * @param {string} sessionId 原会话 id
   * @returns {Promise<{ok:true, mode:string}|{ok:false, reason:string}>}
   */
  const archiveOld = async (cwd, sessionId) => {
    if (!registrar || typeof registrar.archive !== 'function') {
      return { ok: false, reason: '没有可用的会话登记器' }
    }
    try {
      return { ok: true, mode: await registrar.archive(cwd, sessionId) }
    } catch (err) {
      const reason = err?.message ? err.message : String(err)
      log?.warn?.('归档原会话失败：', reason)
      return { ok: false, reason }
    }
  }

  return [
    defineTool({
      name: 'session_topics',
      description:
        '把会话按主题自动分段，返回主题清单、轮次区间与字数，并给出覆盖率校验。mode=auto 优先用判断模型，失败自动回退关键词。',
      parameters: schema(
        {
          sessionId: str('会话 id 或前缀'),
          mode: { type: 'string', enum: MODES, description: 'auto（默认）| model | keyword' },
        },
        ['sessionId'],
      ),
      async handler(args, exec) {
        const session = requireSession(args.sessionId)
        const mode = MODES.includes(args.mode) ? args.mode : 'auto'
        const { events } = readSession(session.file)
        const items = extractTurns(events)
        const { segs, note } = await resolveTopics(items, mode, exec)
        const cov = coverage(items, segs)
        const lines = [`主题分段（${note}）：`]
        for (const s of segs) lines.push(`  ${s.label}  轮次 ${s.from}-${s.to}  ${fmt(s.chars)} 字`)
        lines.push('')
        const verdict = cov.ok ? '一致 ✔' : '不一致 ✘'
        lines.push(
          `覆盖率：轮次 ${cov.coveredTurns}/${cov.totalTurns}，` +
            `字数 ${fmt(cov.coveredChars)}/${fmt(cov.totalChars)} → ${verdict}`,
        )
        log.debug('session_topics', { sessionId: session.dirName, segs: segs.length, mode })
        return lines.join('\n')
      },
    }),

    defineTool({
      name: 'session_export',
      description:
        '把选中的轮次导出成独立会话（一问一答结构）。ranges 为连续区间（"0-51,52-87"）；' +
        'turns 为任意轮次集合（"3,7-9,20"），用于精确挑选散落在各处的同主题内容；二者只能给一个。' +
        'dryRun=true 只预览不写入；不给 ranges/turns 时按主题分段给出计划。',
      parameters: schema(
        {
          sessionId: str('源会话 id 或前缀'),
          ranges: str('连续区间，如 "0-51,52-87"；与 turns 互斥'),
          turns: str('任意轮次集合，如 "3,7-9,20"；与 ranges 互斥'),
          title: str('新会话标题（可选）'),
          dryRun: bool('true = 只预览，不写文件'),
          cut: bool('true = 导出后把选中轮次从源会话剪掉（原会话归档，主会话只剩其余部分）'),
          mode: { type: 'string', enum: MODES, description: 'dryRun 自动分段时的模式：auto | model | keyword' },
        },
        ['sessionId'],
      ),
      async handler(args, exec) {
        const session = requireSession(args.sessionId)
        const { header, events } = readSession(session.file)
        const items = extractTurns(events)
        const dryRun = args.dryRun === true
        const selection = selectionFromArgs(args, items.length, cfg)

        if (!selection) {
          if (!dryRun) {
            throw new SessionSplitError(ERR.RANGE_INVALID, '需要 ranges 或 turns，例如 0-51 或 3,7-9,20')
          }
          const mode = MODES.includes(args.mode) ? args.mode : 'auto'
          const { segs, note } = await resolveTopics(items, mode, exec)
          const totalTurns = segs.reduce((n, s) => n + (s.to - s.from + 1), 0)
          const totalChars = segs.reduce((n, s) => n + s.chars, 0)
          const lines = [`预览（${note}）；未写入任何文件：`]
          for (const s of segs) {
            lines.push(`  ${s.from}-${s.to}  ${s.label}  ${s.to - s.from + 1} 轮  ${fmt(s.chars)} 字`)
          }
          lines.push('')
          lines.push(`合计：${segs.length} 段，${totalTurns} 轮，${fmt(totalChars)} 字；将新建 ${segs.length} 个会话`)
          lines.push('确认后按段调用 session_export（填 ranges 或 turns）即可写入。')
          return lines.join('\n')
        }

        const cov = selectionCoverage(items, selection.indices)
        const frag = selection.runs.length

        if (dryRun) {
          const lines = [
            '预览（未写入）：',
            `  选中 ${cov.selectedTurns} 轮 / ${fmt(cov.selectedChars)} 字；` +
              `${frag} 个连续块（${describeRuns(selection.runs)}）`,
          ]
          if (selection.normalized) lines.push('  已合并重叠或相邻的输入项')
          if (frag > 1) lines.push('  注意：选中轮次不连续，导出会话会缺少中间上下文')
          const willCreate = args.cut === true ? 2 : 1
          lines.push(
            `  排除 ${cov.excludedTurns} 轮 / ${fmt(cov.excludedChars)} 字；` +
              `选中 + 排除 = 源会话 ${cov.totalTurns} 轮 / ${fmt(cov.totalChars)} 字；` +
              `将新建 ${willCreate} 个会话`,
          )
          if (args.cut === true) {
            const plan = planCut(items, selection.runs)
            lines.push(
              `  同时剪除：主会话保留 ${plan.remainingTurns} 轮 / ${fmt(plan.remainingChars)} 字，原会话归档`,
            )
          }
          lines.push('确认后去掉 dryRun 再调用一次即可写入。')
          return lines.join('\n')
        }

        const cutPlan = args.cut === true ? planCut(items, selection.runs) : null
        if (cutPlan && cutPlan.remainingTurns === 0) {
          throw new SessionSplitError(ERR.EMPTY_RESULT, '剪除后主会话为空，已拒绝执行')
        }
        const cwd = header.cwd ?? process.cwd()
        const pairs = selection.indices.map((i) => [items[i].user, items[i].assistant])
        const made = createSession({ cwd, pairs, title: args.title })
        await registerNew(cwd, made.id)
        log.info('导出成功', { from: session.dirName, to: made.id, turns: made.turns })
        const lines = [`已导出 ${made.turns} 轮（${frag} 段）→ ${made.id}`]
        if (frag > 1) lines.push('提示：选中轮次不连续，导出的会话缺少中间上下文。')
        if (cutPlan) {
          const main = createSession({
            cwd,
            pairs: toPairs(cutPlan.keep),
            title: `${args.title ?? '主会话'}（已剪除独立段）`,
          })
          await registerNew(cwd, main.id)
          const archived = await archiveOld(cwd, session.dirName)
          lines.push(`已重建主会话 ${main.turns} 轮 → ${main.id}`)
          if (archived.ok) {
            lines.push('原会话已归档（不再出现在会话列表，文件保持原样可随时取消归档）')
          } else {
            lines.push(`原会话未归档：${archived.reason}`)
            lines.push('它仍会出现在会话列表里；可在列表里右键「归档」，或等它空闲后重试。')
          }
          lines.push('注意：如果目标会话正在其它标签页打开，请关闭后重新打开列表。')
          log.info('导出并剪除完成', { from: session.dirName, to: made.id, main: main.id })
        }
        return lines.join('\n')
      },
    }),

    defineTool({
      name: 'session_cut',
      description:
        '把选中的轮次从会话中剪掉：用剩余轮次重建一个新会话。ranges 连续区间或 turns 任意轮次集合（二者互斥）。' +
        '默认只预览，dryRun=false 才执行；archive=true 时归档原会话。注意：重建后的会话只保留文字。',
      parameters: schema(
        {
          sessionId: str('源会话 id 或前缀'),
          ranges: str('要剪掉的连续区间，如 "78-92"；与 turns 互斥'),
          turns: str('要剪掉的任意轮次，如 "3,7-9"；与 ranges 互斥'),
          dryRun: bool('true = 只预览（默认）'),
          archive: bool('true = 归档原会话'),
          title: str('重建后的会话标题（可选）'),
        },
        ['sessionId'],
      ),
      async handler(args) {
        const session = requireSession(args.sessionId)
        const { header, events } = readSession(session.file)
        const items = extractTurns(events)
        const selection = selectionFromArgs(args, items.length, cfg)
        if (!selection) {
          throw new SessionSplitError(ERR.RANGE_INVALID, '需要 ranges 或 turns，例如 78-92 或 3,7-9')
        }
        const plan = planCut(items, selection.runs)
        if (plan.remainingTurns === 0) {
          throw new SessionSplitError(ERR.EMPTY_RESULT, '不能剪掉整个会话')
        }
        const cwd = header.cwd ?? process.cwd()
        const spec = String(args.turns ?? args.ranges ?? '')
        const lines = [
          `剪除计划：${spec}（${selection.runs.length} 段）`,
          `  剪掉 ${plan.removedTurns} 轮 / ${fmt(plan.removedChars)} 字`,
          `  保留 ${plan.remainingTurns} 轮 / ${fmt(plan.remainingChars)} 字`,
          '  注意：重建会话只保留文字，工具调用记录不会带入。',
        ]
        const dryRun = args.dryRun !== false
        if (dryRun) {
          lines.push('')
          lines.push('预览（未写入）；确认后传 dryRun:false 执行。')
          return lines.join('\n')
        }
        const made = createSession({ cwd, pairs: toPairs(plan.keep), title: args.title })
        await registerNew(cwd, made.id)
        lines.push('')
        lines.push(`已重建会话：${made.id}（${made.turns} 轮）`)
        if (args.archive === true) {
          const archived = await archiveOld(cwd, session.dirName)
          if (archived.ok) {
            lines.push('原会话已归档（不再出现在会话列表，文件保持原样可随时取消归档）')
          } else {
            lines.push(`原会话未归档：${archived.reason}`)
            lines.push('它仍会出现在会话列表里；可在列表里右键「归档」，或等它空闲后重试。')
          }
          lines.push('注意：如果目标会话正在其它标签页打开，请关闭后重新打开列表。')
        } else {
          lines.push('原会话未改动；确认无误后可再执行归档或手动删除。')
        }
        log.info('会话剪除完成', { from: session.dirName, to: made.id, removed: plan.removedTurns })
        return lines.join('\n')
      },
    }),

    defineTool({
      name: 'session_coverage',
      description:
        '核对「选中 + 排除 = 原对话」：ranges 连续区间或 turns 任意轮次集合（二者互斥），按轮次与字数双维度校验。',
      parameters: schema(
        {
          sessionId: str('会话 id 或前缀'),
          ranges: str('要核对的连续区间，如 "0-159"；与 turns 互斥'),
          turns: str('要核对的任意轮次，如 "3,7-9,20"；与 ranges 互斥'),
        },
        ['sessionId'],
      ),
      handler(args) {
        const session = requireSession(args.sessionId)
        const { events } = readSession(session.file)
        const items = extractTurns(events)
        const selection = selectionFromArgs(args, items.length, cfg)
        if (!selection) {
          throw new SessionSplitError(ERR.RANGE_INVALID, '需要 ranges 或 turns，例如 0-159 或 3,7-9')
        }
        const cov = selectionCoverage(items, selection.indices)
        const verdict = cov.ok ? '一致 ✔' : '不一致 ✘'
        const lines = [
          `源会话 ${cov.totalTurns} 轮 / ${fmt(cov.totalChars)} 字`,
          `选中 ${cov.selectedTurns} 轮 / ${fmt(cov.selectedChars)} 字（${selection.runs.length} 个连续块）`,
          `排除 ${cov.excludedTurns} 轮 / ${fmt(cov.excludedChars)} 字`,
          `合计 ${cov.selectedTurns + cov.excludedTurns} 轮 / ` +
            `${fmt(cov.selectedChars + cov.excludedChars)} 字 → ${verdict}`,
        ]
        if (cov.complete) lines.push('（选中即全量）')
        return lines.join('\n')
      },
    }),
    defineTool({
      name: 'session_diag',
      description: '输出插件自检信息：路径、配置、缓存命中率、判断模型状态与开关，用于排障。',
      parameters: schema({}, []),
      handler() {
        return buildDiagnostics({
          cfg,
          readerStats: () => readSession.stats?.(),
          toolNames: getToolNames ? getToolNames() : [],
          judge: judge ? judge.describe() : '不可用（回退关键词规则）',
        })
      },
    }),
  ]
}

// 延迟导入，避免 tools.js 与 store.js 形成初始化环
let resolveSessionFn = null
/**
 * 注入会话解析函数（由插件入口调用，避免循环依赖）。
 * @param {(id: string) => any} fn
 */
export function __setResolver(fn) {
  resolveSessionFn = fn
}
function requireSession(id) {
  if (!resolveSessionFn) throw new SessionSplitError(ERR.SESSION_NOT_FOUND, '会话解析器未初始化')
  return resolveSessionFn(id)
}
