/** 错误码：所有失败路径都带 code，便于日志过滤与调用方判断。 */
export const ERR = Object.freeze({
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_ID_INVALID: 'SESSION_ID_INVALID',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_CORRUPT: 'FILE_CORRUPT',
  RANGE_INVALID: 'RANGE_INVALID',
  RANGE_TOO_MANY: 'RANGE_TOO_MANY',
  TURNS_INVALID: 'TURNS_INVALID',
  EMPTY_RESULT: 'EMPTY_RESULT',
  CONFIG_INVALID: 'CONFIG_INVALID',
  PATH_OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  IO_FAILED: 'IO_FAILED',
  JUDGE_UNAVAILABLE: 'JUDGE_UNAVAILABLE',
  JUDGE_TIMEOUT: 'JUDGE_TIMEOUT',
  JUDGE_BAD_OUTPUT: 'JUDGE_BAD_OUTPUT',
  ABORTED: 'ABORTED',
})

/**
 * 带错误码的插件异常。
 * @extends Error
 */
export class SessionSplitError extends Error {
  /**
   * @param {string} code 错误码（见 ERR）
   * @param {string} message 面向用户的说明
   * @param {Record<string, unknown>} [details] 附加上下文
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'SessionSplitError'
    this.code = code
    this.details = details ?? {}
  }
}

/** 把任意异常规整成 SessionSplitError。 */
export function asSplitError(err, fallbackCode = ERR.IO_FAILED) {
  if (err instanceof SessionSplitError) return err
  const message = err && err.message ? err.message : String(err)
  return new SessionSplitError(fallbackCode, message)
}
