/** 逐个运行 test/*.test.js（独立进程，避免共享 DSH_HOME），汇总退出码。
 *
 * 为什么不用 `node --test`：某些受限环境禁止子进程管道（EPERM），
 * 而这里用 stdio: 'inherit'，不经过管道。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const testDir = join(here, '..', 'test')
const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()

let failed = 0
for (const file of files) {
  process.stdout.write(`\n=== ${file}\n`)
  const result = spawnSync(process.execPath, [join(testDir, file)], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}
process.stdout.write(`\n${files.length - failed}/${files.length} 个测试文件通过\n`)
process.exitCode = failed === 0 ? 0 : 1
