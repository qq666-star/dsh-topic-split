/** 判断模型适配层：把「按主题分段」交给 LLM，失败由调用方回退关键词规则。
 *
 * 设计要点：
 * - 只喂每轮摘要（用户首句 + 助手首句），不喂全文，成本降低一个数量级；
 * - 输出必须是 JSON，且在代码里硬校验「连续、不重叠、全覆盖」；
 * - 校验失败重试一次，仍失败则抛 JUDGE_BAD_OUTPUT，由上层决定回退。
 */
import { randomUUID } from 'node:crypto'

import { ERR, SessionSplitError, asSplitError } from './errors.js'

/** 判断模型的系统提示：约束输出格式与覆盖规则。 */
export const JUDGE_SYSTEM = [
  '你是会话主题分段器。输入是按轮次编号的对话摘要，每行形如：',
  '#12 用户：…… ｜ 助手：……',
  '请把相邻轮次按主题合并成若干连续段，只输出 JSON，不要解释。',
  '输出格式：{"segments":[{"label":"简短主题名","from":0,"to":51},{"label":"另一个主题","from":52,"to":96}]}',
  '硬性要求：',
  '1. from/to 都是轮次编号，从 0 开始，段与段首尾相接、不重叠、不遗漏，最后一段的 to 必须等于最后一轮编号。',
  '2. 每段至少 3 轮；主题名不超过 12 个汉字，概括该段实际内容。',
  '3. 只有确实无法归类时才用「其他」。',
  '4. 只输出 JSON 对象，不要 Markdown 代码块，不要多余文字。',
].join('\n')

/** 摘要超长时按预算压缩每轮字符数（保证所有轮次都进提示词）。 */
function perTurnBudget(totalTurns, cfg) {
  const sem = cfg.semantic
  const budget = Math.floor((sem.maxTurnsInPrompt * sem.summaryChars) / Math.max(totalTurns, 1))
  return Math.max(24, Math.min(sem.summaryChars, budget))
}

function firstLine(text, limit) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit) + '…'
}

/**
 * 生成每轮摘要行。
 * @param {Array<{turn:number, user:string, assistant:string}>} items
 * @param {{semantic:{summaryChars:number, maxTurnsInPrompt:number}}} cfg
 * @returns {string[]}
 */
export function summarizeTurns(items, cfg) {
  const budget = perTurnBudget(items.length, cfg)
  return items.map((item) => {
    const user = firstLine(item.user, budget)
    const assistant = firstLine(item.assistant, Math.floor(budget / 2))
    return `#${item.turn} 用户：${user} ｜ 助手：${assistant}`
  })
}

/**
 * 构造判断模型的用户输入。
 * @param {Array<{turn:number, user:string, assistant:string}>} items
 * @param {object} cfg
 * @returns {string}
 */
export function buildPrompt(items, cfg) {
  const lines = summarizeTurns(items, cfg)
  return [
    `共有 ${items.length} 轮对话（编号 0..${items.length - 1}）。`,
    '摘要如下：',
    ...lines,
    '',
    '请输出 JSON。',
  ].join('\n')
}

/** 从可能带代码块的回复里取出 JSON 文本。 */
function extractJson(text) {
  const raw = String(text ?? '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = fenced ? fenced[1].trim() : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 校验并规范化模型给的分段：必须连续覆盖 0..totalTurns-1。
 * @param {unknown} payload 解析后的 JSON
 * @param {number} totalTurns
 * @param {{maxRanges:number}} cfg
 * @returns {Array<{label:string, from:number, to:number}>}
 */
export function validateSegments(payload, totalTurns, cfg) {
  const list = payload && typeof payload === 'object' ? payload.segments : null
  if (!Array.isArray(list) || list.length === 0) {
    throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '模型输出缺少 segments 数组')
  }
  if (list.length > cfg.maxRanges) {
    throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `模型给了 ${list.length} 段，超过上限 ${cfg.maxRanges}`)
  }
  const out = []
  let cursor = 0
  for (const [index, entry] of list.entries()) {
    const from = Number(entry?.from)
    const to = Number(entry?.to)
    const label = String(entry?.label ?? '').trim()
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `第 ${index + 1} 段的 from/to 不是整数`)
    }
    if (from !== cursor) {
      throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `第 ${index + 1} 段应从 ${cursor} 开始，实际 ${from}`)
    }
    if (to < from) {
      throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `第 ${index + 1} 段终点小于起点`)
    }
    if (to >= totalTurns) {
      throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `第 ${index + 1} 段超出范围（共 ${totalTurns} 轮）`)
    }
    if (!label) throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `第 ${index + 1} 段没有主题名`)
    out.push({ label: label.slice(0, 24), from, to })
    cursor = to + 1
  }
  if (cursor !== totalTurns) {
    throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `只覆盖到 ${cursor} 轮，共 ${totalTurns} 轮`)
  }
  return out
}

/**
 * 解析模型回复。
 * @param {string} text 模型原始回复
 * @param {number} totalTurns
 * @param {{maxRanges:number}} cfg
 */
export function parseJudgeOutput(text, totalTurns, cfg) {
  const payload = extractJson(text)
  if (!payload) throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '模型回复不是合法 JSON')
  return validateSegments(payload, totalTurns, cfg)
}

/** 组合父信号与超时，得到子信号。 */
function withDeadline(parent, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => {
    ctrl.abort(new SessionSplitError(ERR.JUDGE_TIMEOUT, `判断模型超时（${ms}ms）`))
  }, ms)
  if (typeof timer.unref === 'function') timer.unref()
  const onAbort = () => ctrl.abort(parent?.reason)
  if (parent) {
    if (parent.aborted) onAbort()
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    dispose() {
      clearTimeout(timer)
      if (parent) parent.removeEventListener('abort', onAbort)
    },
  }
}

/** 把任意异常规整成带错误码的 SessionSplitError。 */
function judgeError(err) {
  if (err instanceof SessionSplitError) return err
  const code = err?.name === 'AbortError' ? ERR.JUDGE_TIMEOUT : ERR.IO_FAILED
  return new SessionSplitError(code, err?.message ?? String(err))
}

/** 解析宿主 llm 服务：属性直取与 ctx.get 双路径，取不到返回 null。 */
function resolveLlm(ctx) {
  if (!ctx) return null
  try {
    const direct = ctx.llm
    if (direct && typeof direct.prepareCall === 'function') return direct
  } catch {
    /* 服务未注册时某些版本会抛错，继续尝试 ctx.get */
  }
  try {
    const got = typeof ctx.get === 'function' ? ctx.get('llm') : null
    if (got && typeof got.prepareCall === 'function') return got
  } catch {
    /* 忽略，按不可用处理 */
  }
  return null
}

/** 走宿主内核 LLM 服务（不需要额外密钥）。 */
function createKernelJudge({ ctx, cfg, log }) {
  const sem = cfg.semantic
  const llm = resolveLlm(ctx)
  if (!llm) {
    log?.warn('kernel 判断后端不可用：宿主没有 llm 服务')
    return null
  }
  return {
    kind: 'kernel',
    describe: () => `内核模型 ${sem.provider}/${sem.model}`,
    async complete(prompt, signal) {
      try {
        const call = await llm.prepareCall(
          { provider: sem.provider, model: sem.model, maxTokens: sem.maxOutputTokens },
          signal,
        )
        const messages = [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'dsh-topic-split' },
            id: randomUUID(),
          },
        ]
        let streamed = ''
        let blocks = ''
        let finish = null
        for await (const chunk of call.stream({ ...call.config, messages, system: JUDGE_SYSTEM, signal })) {
          if (!chunk) continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            streamed += chunk.text
          } else if (chunk.type === 'block-end') {
            // 部分适配器不流式发 delta，只在块结束时给完整文本
            const block = chunk.block
            if (block && block.type === 'text' && typeof block.text === 'string') blocks += block.text
          } else if (chunk.type === 'finish') {
            finish = chunk.reason
          }
        }
        const text = streamed || blocks
        if (!text.trim()) {
          if (finish && finish.kind === 'error') {
            throw new SessionSplitError(
              ERR.JUDGE_UNAVAILABLE,
              `内核模型失败：${finish.failure?.message ?? '未知错误'}`,
            )
          }
          if (finish && finish.kind === 'aborted') {
            throw new SessionSplitError(ERR.ABORTED, `内核模型中止：${finish.failure?.message ?? '无详情'}`)
          }
          if (finish && finish.kind === 'max-tokens') {
            throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '内核模型输出被 maxTokens 截断且无文本')
          }
          throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '内核模型没有返回文本')
        }
        return text
      } catch (err) {
        throw judgeError(err)
      }
    },
  }
}

/** 走 OpenAI 兼容端点（需要用户自备密钥，密钥只在环境变量里读）。 */
function createHttpJudge({ cfg, log }) {
  const sem = cfg.semantic
  if (!sem.httpBaseUrl) {
    log?.warn('http 判断后端不可用：没有配置 httpBaseUrl')
    return null
  }
  const base = sem.httpBaseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const model = sem.httpModel || 'deepseek-chat'
  return {
    kind: 'http',
    describe: () => `HTTP 端点 ${model}`,
    async complete(prompt, signal) {
      const key = String(process.env[sem.httpKeyEnv] ?? '').trim()
      const headers = { 'content-type': 'application/json' }
      if (key) headers.authorization = `Bearer ${key}`
      let resp
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: JUDGE_SYSTEM },
              { role: 'user', content: prompt },
            ],
            temperature: 0,
            max_tokens: sem.maxOutputTokens,
            response_format: { type: 'json_object' },
          }),
          signal,
        })
      } catch (err) {
        throw judgeError(err)
      }
      if (!resp.ok) {
        throw new SessionSplitError(ERR.JUDGE_UNAVAILABLE, `判断端点返回 HTTP ${resp.status}`)
      }
      let data
      try {
        data = await resp.json()
      } catch (err) {
        throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, `判断端点返回的不是 JSON：${err.message}`)
      }
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) {
        throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '判断端点没有返回文本')
      }
      return text
    },
  }
}

/**
 * 按配置创建判断器；不可用时返回 null（调用方回退关键词规则）。
 * @param {{cfg:object, log?:object, ctx?:any}} input
 * @returns {{kind:string, describe:()=>string, complete:(prompt:string, signal?:AbortSignal)=>Promise<string>}|null}
 */
export function createJudge({ cfg, log, ctx }) {
  const sem = cfg.semantic
  const backend = sem.backend
  if (backend === 'off') return null
  if (backend === 'kernel') return createKernelJudge({ ctx, cfg, log })
  if (backend === 'http') return createHttpJudge({ cfg, log })
  // auto：优先内核（无需密钥），其次 HTTP 端点
  const kernel = createKernelJudge({ ctx, cfg, log })
  if (kernel) return kernel
  return createHttpJudge({ cfg, log })
}

/**
 * 调一次判断模型并解析，带超时与重试。
 * @param {object} judge
 * @param {Array<{turn:number, user:string, assistant:string}>} items
 * @param {object} cfg
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{label:string, from:number, to:number}>>}
 */
export async function segmentByJudge(judge, items, cfg, signal) {
  const sem = cfg.semantic
  if (items.length < 2) {
    throw new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '轮次太少，无法做主题分段')
  }
  const prompt = buildPrompt(items, cfg)
  let lastError = null
  for (let attempt = 0; attempt <= sem.retries; attempt++) {
    if (signal?.aborted) throw new SessionSplitError(ERR.ABORTED, '调用已取消')
    const call = withDeadline(signal, sem.timeoutMs)
    try {
      const text = await judge.complete(prompt, call.signal)
      return parseJudgeOutput(text, items.length, cfg)
    } catch (err) {
      lastError = asSplitError(err)
      if (lastError.code === ERR.ABORTED) throw lastError
    } finally {
      call.dispose()
    }
  }
  throw lastError ?? new SessionSplitError(ERR.JUDGE_BAD_OUTPUT, '判断模型失败')
}
