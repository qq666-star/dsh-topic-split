/** 导出：把 (用户, 助手) 配对构造成合法的 DSH 会话文件并登记。
 *
 * 结构对齐真实会话（否则被 GUI resume 追加时会因缺少保护头而损坏）：
 *   permission/preset → sandbox/mode → approval/policy → session/end-seed
 *   每轮：agent/inbox/spliced(insert) → turn/start → agent/inbox/spliced(remove)
 *          → step/start → [仅第 1 轮] system/message → user/message
 *          → assistant/message → step/end → turn/end
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { ERR, SessionSplitError } from './errors.js'
import { atomicWrite, sessionsRoot, slugFor } from './store.js'
import { encodeSession } from './zstd.js'

const MODEL_SOURCE = Object.freeze({ kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' })
const SYSTEM_PROMPT = 'You are an AI agent powered by DeepSeek Harness.'

/** 真实会话的固定头部（缺了它，追加事件会报 "protected first surface head"）。 */
export function headEvents(createdAt = Date.now()) {
  return [
    { type: 'permission/preset', time: createdAt, data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', time: createdAt + 1, data: { mode: 'workspace-write' } },
    { type: 'approval/policy', time: createdAt + 2, data: { policy: 'ask' } },
    { type: 'session/end-seed', time: createdAt + 3, data: {} },
  ]
}

function userObject(text) {
  const rpcId = randomUUID()
  return {
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId, clientTimeZone: 'Asia/Shanghai' },
    role: 'user',
    id: randomUUID(),
  }
}

/**
 * 生成事件序列。turn 从 1 开始、seq 从 0 连续递增——DSH 校验硬要求。
 * @param {Array<[string,string]>} pairs
 * @param {number} [createdAt]
 */
export function buildEvents(pairs, createdAt = Date.now()) {
  const events = []
  const push = (ev) => {
    events.push({ ...ev, seq: events.length })
  }

  for (const ev of headEvents(createdAt)) push(ev)

  pairs.forEach(([user, assistant], index) => {
    const turn = index + 1
    const at = createdAt + 10 + index * 60_000
    const userObj = userObject(user)

    // 轮前注入（真实会话里用户消息先进入 next-turn 队列）
    push({
      type: 'agent/inbox/spliced',
      time: at,
      data: { target: 'next-turn', start: 0, inserted: [userObj] },
    })
    push({ type: 'turn/start', time: at + 3, data: { turn } })
    push({
      type: 'agent/inbox/spliced',
      time: at + 6,
      data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] },
    })
    push({ type: 'step/start', time: at + 9, data: { turn, step: 1 } })

    // 只有第 1 轮带 system/message（受保护的首次 surface）
    if (turn === 1) {
      push({
        type: 'system/message',
        time: at + 12,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'system',
            content: [{ type: 'text', text: SYSTEM_PROMPT }],
            source: { kind: 'system-prompt' },
            id: randomUUID(),
          },
        },
      })
    }

    push({ type: 'user/message', time: at + 15, surfaceOp: 'append', data: userObj })

    if (assistant) {
      push({
        type: 'assistant/message',
        time: at + 18,
        surfaceOp: 'append',
        data: {
          turn,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: assistant }],
            source: MODEL_SOURCE,
            id: randomUUID(),
          },
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
          stream: [],
        },
      })
    }

    push({ type: 'step/end', time: at + 21, data: { turn, step: 1 } })
    push({ type: 'turn/end', time: at + 24, data: { turn, reason: { kind: 'completed' } } })
  })

  return events
}

/**
 * 创建独立会话。
 * @param {{cwd:string, pairs:Array<[string,string]>, title?:string}} input
 * @returns {{id:string, file:string, turns:number}}
 */
export function createSession({ cwd, pairs, title }) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new SessionSplitError(ERR.EMPTY_RESULT, '没有可导出的对话内容')
  }
  // 空 cwd 回退到当前目录：DSH 的 projectKey 不接受空路径
  const projectCwd = String(cwd ?? '').trim() ? cwd : process.cwd()
  const id = 'session-' + randomUUID()
  const createdAt = Date.now()
  const header = {
    type: 'session',
    version: 4,
    id,
    createdAt,
    cwd: projectCwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'standard',
  }
  const events = buildEvents(pairs, createdAt)
  const dir = join(sessionsRoot(), slugFor(projectCwd), id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.v4.jsonl.zstd')
  atomicWrite(file, encodeSession(header, events))
  return { id, file, turns: pairs.length, title: title ?? '' }
}
