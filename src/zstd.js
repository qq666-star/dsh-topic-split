/**
 * DSH 会话日志的 zstd 编解码。
 *
 * 关键事实：DSH 的 `.jsonl.zstd` 是「多帧」结构——第一帧只放 header，
 * 后续帧是事件批次。Node 的 zstdDecompressSync 只解第一帧，
 * 因此这里按帧魔数（0x28 B5 2F FD）逐段解压再拼接。
 */
import zlib from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 找出所有帧起点。 */
export function frameOffsets(buf) {
  const out = []
  let at = buf.indexOf(MAGIC, 0)
  while (at !== -1) {
    out.push(at)
    at = buf.indexOf(MAGIC, at + 4)
  }
  return out
}

/**
 * 解压全部分帧。
 * @param {Buffer} buf
 * @returns {Buffer} 拼接后的完整内容
 */
export function decodeAll(buf) {
  const starts = frameOffsets(buf)
  if (starts.length === 0) {
    // 没有魔数：交给 zlib 自己判断（可能是不带帧头的裸数据）
    return zlib.zstdDecompressSync(buf)
  }
  if (starts.length === 1) return zlib.zstdDecompressSync(buf)
  const parts = []
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]
    const to = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(from, to)))
    } catch {
      // 尾帧可能正被写入方追加，截断帧直接跳过，保留已解出的部分
    }
  }
  return Buffer.concat(parts)
}

/** 压成单帧（用于测试和普通数据）。 */
export function compress(buf) {
  return zlib.zstdCompressSync(buf)
}

/**
 * 生成合法的会话文件内容：header 单独一帧，事件另起一帧。
 * @param {Record<string, unknown>} header
 * @param {Record<string, unknown>[]} events
 */
export function encodeSession(header, events) {
  const head = Buffer.from(JSON.stringify(header) + '\n', 'utf8')
  const rest = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  return Buffer.concat([compress(head), compress(rest)])
}

/**
 * 解析会话内容，容忍尾帧截断。
 * @param {Buffer} buf
 */
export function decodeSession(buf) {
  const text = decodeAll(buf).toString('utf8')
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { header: null, events: [] }
  const header = JSON.parse(lines[0])
  const events = []
  for (const line of lines.slice(1)) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // 最后一行可能被截断；忽略
    }
  }
  return { header, events }
}
