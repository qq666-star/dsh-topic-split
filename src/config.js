import { ERR, SessionSplitError } from './errors.js'

/** 默认配置：所有可调项集中于此。 */
export const DEFAULTS = Object.freeze({
  maxCompressedBytes: 80 * 1024 * 1024,
  maxInflatedBytes: 300 * 1024 * 1024,
  cacheEntries: 8,
  minSegmentTurns: 3,
  minSegmentChars: 4000,
  maxRanges: 50,
  httpRoutes: 'token',
  httpToken: '',
  httpRateLimitPerMin: 60,
  httpExportPerMin: 6,
  exposeTitles: true,
  semantic: Object.freeze({
    backend: 'auto',
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    maxOutputTokens: 900,
    timeoutMs: 25000,
    retries: 1,
    summaryChars: 120,
    maxTurnsInPrompt: 600,
    httpBaseUrl: '',
    httpModel: '',
    httpKeyEnv: 'DSH_SESSION_SPLIT_JUDGE_KEY',
  }),
  topics: Object.freeze([
    ['桌宠/形象/语音', '桌宠|美杜莎|动作|形象|立绘|抠图|语音|音色|台词|表情包'],
    ['网页背景', '背景图|聊天背景|侧栏背景|注入|CSS|样式|去水印|虚化'],
    ['视频生成', '视频|通义万相|抽帧|帧率|mp4|gif|播放器'],
    ['参赛方案', '参赛|大赛|创意组|方案[ABCD]|奖项|成本|具身|MuJoCo|机器人|仿真'],
    ['会话管理/插件', '会话|分叉|独立对话|插件|profile|schema|工具注册'],
    ['系统维护', '磁盘|C盘|D盘|软件|卸载|迁移|junction|VS|Ollama|豆包'],
    ['密钥/隐私', '密钥|API ?Key|额度|账单|环境变量|权限|隐私'],
  ]),
})

const NUMERIC_KEYS = [
  ['maxCompressedBytes', 1, 2 ** 40],
  ['maxInflatedBytes', 1, 2 ** 40],
  ['cacheEntries', 1, 64],
  ['minSegmentTurns', 1, 1000],
  ['minSegmentChars', 1, 10 ** 7],
  ['maxRanges', 1, 1000],
]

const SEMANTIC_NUMERIC_KEYS = [
  ['maxOutputTokens', 64, 8192],
  ['timeoutMs', 1000, 120000],
  ['retries', 0, 3],
  ['summaryChars', 20, 500],
  ['maxTurnsInPrompt', 10, 5000],
]

const BACKENDS = ['auto', 'kernel', 'http', 'off']
const HTTP_ROUTE_MODES = ['off', 'token']

/** 从环境变量读取 HTTP 面板开关（未设置的保持原值）。 */
function applyHttpEnv(cfg) {
  const env = process.env
  if (env.DSH_SESSION_SPLIT_HTTP) cfg.httpRoutes = env.DSH_SESSION_SPLIT_HTTP
  return cfg
}

/** 从环境变量读取判断模型覆盖项（未设置的保持原值）。 */
function applySemanticEnv(semantic) {
  const env = process.env
  if (env.DSH_SESSION_SPLIT_JUDGE) semantic.backend = env.DSH_SESSION_SPLIT_JUDGE
  if (env.DSH_SESSION_SPLIT_JUDGE_PROVIDER) semantic.provider = env.DSH_SESSION_SPLIT_JUDGE_PROVIDER
  if (env.DSH_SESSION_SPLIT_JUDGE_MODEL) semantic.model = env.DSH_SESSION_SPLIT_JUDGE_MODEL
  if (env.DSH_SESSION_SPLIT_JUDGE_URL) semantic.httpBaseUrl = env.DSH_SESSION_SPLIT_JUDGE_URL
  if (env.DSH_SESSION_SPLIT_JUDGE_HTTP_MODEL) semantic.httpModel = env.DSH_SESSION_SPLIT_JUDGE_HTTP_MODEL
  if (env.DSH_SESSION_SPLIT_JUDGE_KEY_ENV) semantic.httpKeyEnv = env.DSH_SESSION_SPLIT_JUDGE_KEY_ENV
  return semantic
}

/**
 * 合并并校验配置；非法值直接抛 CONFIG_INVALID（启动即失败，避免带病运行）。
 * @param {Record<string, unknown>} [input]
 */
export function resolveConfig(input) {
  const raw = input ?? {}
  const semanticInput = raw.semantic && typeof raw.semantic === 'object' ? raw.semantic : {}
  const cfg = applyHttpEnv({
    ...DEFAULTS,
    ...raw,
    semantic: applySemanticEnv({ ...DEFAULTS.semantic, ...semanticInput }),
  })
  const fail = (key, why) => {
    throw new SessionSplitError(ERR.CONFIG_INVALID, `配置项 ${key} 非法：${why}`, { key })
  }
  for (const [key, min, max] of NUMERIC_KEYS) {
    const v = cfg[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      fail(key, `需要 ${min}..${max} 的数字，收到 ${String(v)}`)
    }
  }
  const sem = cfg.semantic
  if (!BACKENDS.includes(sem.backend)) fail('semantic.backend', `需要 ${BACKENDS.join('/')}，收到 ${String(sem.backend)}`)
  for (const [key, min, max] of SEMANTIC_NUMERIC_KEYS) {
    const v = sem[key]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      fail(`semantic.${key}`, `需要 ${min}..${max} 的整数，收到 ${String(v)}`)
    }
  }
  for (const key of ['provider', 'model', 'httpBaseUrl', 'httpModel', 'httpKeyEnv']) {
    if (typeof sem[key] !== 'string') fail(`semantic.${key}`, '需要字符串')
  }
  if (sem.backend === 'kernel' && (!sem.provider || !sem.model)) {
    fail('semantic.provider', 'kernel 后端需要 provider 与 model')
  }
  if (!HTTP_ROUTE_MODES.includes(cfg.httpRoutes)) {
    fail('httpRoutes', `需要 ${HTTP_ROUTE_MODES.join('/')}，收到 ${String(cfg.httpRoutes)}`)
  }
  if (typeof cfg.httpToken !== 'string') fail('httpToken', '需要字符串')
  for (const [key, min, max] of [
    ['httpRateLimitPerMin', 1, 10000],
    ['httpExportPerMin', 1, 1000],
  ]) {
    const v = cfg[key]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      fail(key, `需要 ${min}..${max} 的整数，收到 ${String(v)}`)
    }
  }
  if (typeof cfg.exposeTitles !== 'boolean') fail('exposeTitles', '需要布尔值')
  if (!Array.isArray(cfg.topics) || cfg.topics.length === 0) fail('topics', '需要非空数组')
  cfg.topicRules = cfg.topics.map((entry, i) => {
    const pair = Array.isArray(entry) ? entry : [entry?.label, entry?.pattern]
    const [label, pattern] = pair
    if (typeof label !== 'string' || !label) fail(`topics[${i}].label`, '需要非空字符串')
    if (typeof pattern !== 'string' || !pattern) fail(`topics[${i}].pattern`, '需要正则字符串')
    try {
      return { label, re: new RegExp(pattern, 'u') }
    } catch (err) {
      return fail(`topics[${i}].pattern`, `无法编译正则：${err.message}`)
    }
  })
  return cfg
}
