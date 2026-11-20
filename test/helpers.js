/** 测试辅助：临时 DSH_HOME + 造会话。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 建立隔离的 DSH_HOME，返回 { home, cleanup }。必须在 import store 之前调用。 */
export function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-split-test-'))
  process.env.DSH_HOME = home
  return {
    home,
    cleanup() {
      try {
        rmSync(home, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    },
  }
}

/** 造一组 (user, assistant) 配对，便于测分段。 */
export function makePairs(count, kind = 'pet') {
  const pairs = []
  for (let i = 0; i < count; i++) {
    const user = kind === 'pet' ? `第 ${i} 轮：桌宠语音怎么配置` : `第 ${i} 轮：参赛方案怎么排版`
    pairs.push([user, `回复 ${i}：${'内容'.repeat(20)}`])
  }
  return pairs
}
