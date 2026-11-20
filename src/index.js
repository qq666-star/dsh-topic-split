/** 插件入口：配置校验 → 注册工具。任何失败都不影响宿主启动。 */
import { resolveConfig } from './config.js'
import { SessionSplitError } from './errors.js'
import { createJudge } from './judge.js'
import { createLogger } from './log.js'
import { createRegistrar } from './registry.js'
import { repairArchivedDirs } from './repair.js'
import { registerRoutes } from './routes.js'
import { createSessionReader, resolveSession } from './store.js'
import { __setResolver, createTools } from './tools.js'

/** 插件名（cordis 用它标识插件）。 */
export const name = 'dsh-topic-split'
/** 依赖的内核服务：只要求 tools；webServer 可选（面板 HTTP 路由默认关闭）。 */
export const inject = ['tools']

const log = createLogger('dsh-topic-split')

/**
 * @param {any} ctx cordis 上下文
 * @param {Record<string, unknown>} [config] 用户配置（可选，会与默认值合并校验）
 */
export function apply(ctx, config) {
  if (String(process.env.DSH_SESSION_SPLIT_DISABLE ?? '') === '1') {
    log.warn('已被 DSH_SESSION_SPLIT_DISABLE=1 禁用，跳过注册')
    return
  }
  let cfg
  try {
    cfg = resolveConfig(config)
  } catch (err) {
    log.error('配置非法，插件不注册：', err instanceof SessionSplitError ? `${err.code} ${err.message}` : err)
    return
  }
  const toolsService = ctx?.tools
  if (!toolsService || typeof toolsService.register !== 'function') {
    log.warn('没有 tools 服务，跳过注册')
    return
  }
  // 先自愈历史遗留的「改名归档」目录：它们会让 DSH 的会话列表整份读取失败
  try {
    const repaired = repairArchivedDirs({ log })
    if (repaired.length > 0) {
      log.warn(`已修复 ${repaired.length} 个被改名的归档目录；这些会话会重新出现在列表里`)
    }
  } catch (err) {
    log.warn('归档目录自愈失败：', err && err.message ? err.message : err)
  }
  // 必须绑定 this：直接取方法引用会丢上下文（this.layers 未定义）
  const register = toolsService.register.bind(toolsService)
  /** 收集所有可释放的注册，插件卸载时统一清理。 */
  const disposers = []
  const hold = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer)
  }
  try {
    __setResolver(resolveSession)
    const readSession = createSessionReader(cfg)
    let judge = null
    try {
      judge = createJudge({ cfg, log, ctx })
    } catch (err) {
      log.warn('判断模型初始化失败，回退关键词规则：', err)
    }
    let toolNames = []
    // workspaceRegistry 是可选依赖：动态注入拿到实例后再用服务登记
    let registryService = null
    if (typeof ctx.inject === 'function') {
      try {
        hold(
          ctx.inject(['workspaceRegistry'], (injected) => {
            registryService = injected.workspaceRegistry
          }),
        )
      } catch (err) {
        log.warn('workspaceRegistry 动态注入失败：', err && err.message ? err.message : err)
      }
    }
    const registrar = createRegistrar({ ctx, log, getService: () => registryService })
    const tools = createTools({ cfg, readSession, log, judge, registrar, getToolNames: () => toolNames })
    toolNames = tools.map((t) => t.name)
    for (const tool of tools) hold(register(tool))
    log.info(`已注册工具：${toolNames.join(', ')}`)
    log.info(`判断模型：${judge ? judge.describe() : '不可用（关键词规则）'}`)
    // HTTP 面板路由：webServer 是可选依赖，用动态注入等它就绪（工具不受影响）
    const startRoutes = (routeCtx) => {
      try {
        hold(
          registerRoutes(routeCtx, { cfg, readSession, log, getToolNames: () => toolNames, judge, registrar }),
        )
      } catch (err) {
        log.warn('HTTP 路由注册失败（工具仍可用）：', err && err.message ? err.message : err)
      }
    }
    if (cfg.httpRoutes === 'token' && typeof ctx.inject === 'function') {
      try {
        hold(ctx.inject(['webServer'], startRoutes))
      } catch (err) {
        log.warn('webServer 动态注入失败，尝试直接注册：', err && err.message ? err.message : err)
        startRoutes(ctx)
      }
    } else {
      startRoutes(ctx)
    }
    if (typeof ctx.effect === 'function') {
      ctx.effect(
        () => () => {
          for (const dispose of disposers.splice(0)) {
            try {
              dispose()
            } catch (err) {
              log.warn('释放注册失败：', err && err.message ? err.message : err)
            }
          }
        },
        'dsh-topic-split: tools + routes',
      )
    }
  } catch (err) {
    log.error('注册失败（宿主继续运行）：', err instanceof SessionSplitError ? `${err.code} ${err.message}` : err)
  }
}
