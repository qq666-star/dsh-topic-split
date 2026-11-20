import test from 'node:test'
import assert from 'node:assert/strict'

import { compress, decodeAll, decodeSession, encodeSession, frameOffsets } from '../src/zstd.js'

test('encodeSession 产生两帧', () => {
  const buf = encodeSession({ type: 'session', id: 's1' }, [
    { type: 'turn/start', seq: 0 },
    { type: 'user/message', seq: 1 },
  ])
  assert.equal(frameOffsets(buf).length, 2)
})

test('decodeSession 能读回多帧内容', () => {
  const header = { type: 'session', version: 4, id: 'session-test' }
  const events = [
    { type: 'turn/start', seq: 0, data: { turn: 1 } },
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '你好' }] } },
  ]
  const buf = encodeSession(header, events)
  const parsed = decodeSession(buf)
  assert.equal(parsed.header.id, 'session-test')
  assert.equal(parsed.events.length, 2)
})

test('decodeAll 拼接多个独立帧', () => {
  const a = Buffer.from('第一段\n', 'utf8')
  const b = Buffer.from('第二段\n', 'utf8')
  const buf = Buffer.concat([compress(a), compress(b)])
  assert.equal(decodeAll(buf).toString('utf8'), '第一段\n第二段\n')
})

test('decodeSession 容忍尾帧被截断', () => {
  const header = { type: 'session', id: 'trunc' }
  const good = encodeSession(header, [{ type: 'turn/start', seq: 0 }])
  const truncated = good.subarray(0, good.length - 6)
  const parsed = decodeSession(truncated)
  assert.equal(parsed.header.id, 'trunc')
  assert.ok(Array.isArray(parsed.events))
})
