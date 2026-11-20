/** 分级日志：默认只输出 info 及以上；DSH_SESSION_SPLIT_DEBUG=1 时输出 debug。 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

function enabledAt() {
  const raw = String(process.env.DSH_SESSION_SPLIT_LOG ?? '').toLowerCase()
  if (raw in LEVELS) return LEVELS[raw]
  return String(process.env.DSH_SESSION_SPLIT_DEBUG ?? '') === '1' ? LEVELS.debug : LEVELS.info
}

/**
 * 创建带前缀与级别的日志器。
 * @param {string} tag 日志前缀
 */
export function createLogger(tag) {
  const threshold = enabledAt()
  const emit = (level, args) => {
    if (LEVELS[level] < threshold) return
    const fn =
      level === 'debug'
        ? console.debug
        : level === 'warn'
          ? console.warn
          : level === 'error'
            ? console.error
            : console.log
    try {
      fn.call(console, `[${tag}]`, ...args)
    } catch {
      /* 日志本身失败不应影响主流程 */
    }
  }
  return {
    debug: (...a) => emit('debug', a),
    info: (...a) => emit('info', a),
    warn: (...a) => emit('warn', a),
    error: (...a) => emit('error', a),
  }
}
