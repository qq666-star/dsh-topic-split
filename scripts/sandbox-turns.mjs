/** 沙盒验证：在临时 DSH_HOME 里反复验证「任意轮次独立」的完整链路。
 *
 * 验证点：
 *  1) 源会话文件字节不变（只读）
 *  2) 选中 + 排除 = 全部（轮次与字数双维度）
 *  3) 导出的会话结构合法：头部事件、seq 连续、轮次与顺序正确
 *  4) dryRun 不写任何文件
 *  5) 写入全部落在临时 DSH_HOME 内
 *  6) 同一流程连跑 3 遍结果稳定
 *
 * 用法：node scripts/sandbox-turns.mjs
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-topic-split-sandbox-'))
process.env.DSH_HOME = home

const { resolveConfig } = await import('../src/config.js')
const { createSession } = await import('../src/exporter.js')
const { createSessionReader, listSessions, registryPath, resolveSession, sessionsRoot } = await import(
  '../src/store.js'
)
const { createTools, __setResolver } = await import('../src/tools.js')
const { extractTurns } = await import('../src/topics.js')

const cfg = resolveConfig()
const log = { debug() {}, info() {}, warn() {}, error() {} }
__setResolver(resolveSession)
const readSession = createSessionReader(cfg)
const tools = Object.fromEntries(createTools({ cfg, readSession, log }).map((t) => [t.name, t]))

let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`✔ ${name}`)
  } else {
    failed += 1
    console.log(`✘ ${name}${detail ? '：' + detail : ''}`)
  }
}

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const turnsOf = (file) => extractTurns(readSession(file).events)

function assertSession(file, expectedUsers, label) {
  const { events } = readSession(file)
  check(`${label}：头部事件完整`, events.slice(0, 4).map((e) => e.type).join(',') ===
    'permission/preset,sandbox/mode,approval/policy,session/end-seed')
  let seqOk = true
  for (let i = 0; i < events.length; i++) if (events[i].seq !== i) seqOk = false
  check(`${label}：seq 连续`, seqOk)
  const users = turnsOf(file).map((t) => t.user)
  check(`${label}：轮次与顺序正确`, users.join(',') === expectedUsers.join(','), users.join(','))
  check(`${label}：写入落在临时 DSH_HOME 内`, file.startsWith(sessionsRoot()))
}

const seeded = createSession({
  cwd: 'D:\\SANDBOX-WS',
  pairs: Array.from({ length: 30 }, (_, i) => [`u${i}`, `a${i}`]),
})
const sourceHash = hash(seeded.file)
const expectedSelected = ['u1', 'u5', 'u7', 'u8', 'u9', 'u12']

console.log(`沙盒：${home}`)
console.log(`源会话：${seeded.id}（30 轮）\n`)

console.log('— 覆盖率（三种选择）')
for (const spec of ['0', '0-14', '1,5,7-9,12']) {
  const out = await tools.session_coverage.execute({ sessionId: seeded.id, turns: spec })
  check(`turns=${spec} 覆盖一致`, /一致 ✔/.test(out), out.replace(/\n/g, ' | '))
}
check('空选择返回明确错误', /错误\[RANGE_INVALID\]/.test(
  await tools.session_export.execute({ sessionId: seeded.id, turns: '   ' }),
))

console.log('\n— dryRun（连跑 3 次，不得写盘）')
const beforeDry = listSessions().length
for (let round = 1; round <= 3; round++) {
  const out = await tools.session_export.execute({
    sessionId: seeded.id,
    turns: '1,5,7-9,12',
    dryRun: true,
  })
  check(`第 ${round} 次预览包含选中/排除`, /选中 6 轮/.test(out) && /排除 24 轮/.test(out))
  check(`第 ${round} 次预览提示不连续`, /4 个连续块/.test(out) && /缺少中间上下文/.test(out))
}
check('dryRun 后会话数不变', listSessions().length === beforeDry, String(listSessions().length))

console.log('\n— 真正导出（连跑 3 次）')
const beforeWrite = listSessions().length
for (let round = 1; round <= 3; round++) {
  const out = await tools.session_export.execute({ sessionId: seeded.id, turns: '1,5,7-9,12' })
  check(`第 ${round} 次导出轮次正确`, /已导出 6 轮（4 段）/.test(out), out.split('\n')[0])
  const id = /→ (session-[0-9a-f-]+)/.exec(out)?.[1]
  const created = id ? listSessions().find((s) => s.dirName === id) : null
  check(`第 ${round} 次导出可被列出`, Boolean(created))
  if (created) assertSession(created.file, expectedSelected, `第 ${round} 次导出`)
}
check('导出后会话数 +3', listSessions().length === beforeWrite + 3, String(listSessions().length))
check('源会话字节未变', hash(seeded.file) === sourceHash)
check('注册表在临时 DSH_HOME 内', registryPath().startsWith(home))

console.log('\n— 剪除（任意轮次）')
const cutOut = await tools.session_cut.execute({
  sessionId: seeded.id,
  turns: '0,2,4',
  dryRun: false,
})
check('剪除报告 3 轮', /剪掉 3 轮/.test(cutOut) && /保留 27 轮/.test(cutOut), cutOut.split('\n')[0])
const cutId = /已重建会话：(\S+?)（/.exec(cutOut)?.[1]
const cutCreated = cutId ? listSessions().find((s) => s.dirName === cutId) : null
check('剪除结果可被列出', Boolean(cutCreated))
if (cutCreated) {
  const users = turnsOf(cutCreated.file).map((t) => t.user)
  check('剪除结果不含被剪轮次', !users.includes('u0') && !users.includes('u2') && !users.includes('u4'))
  check('剪除结果保留 27 轮', users.length === 27, String(users.length))
}

console.log('\n— 互斥与越界')
check('ranges 与 turns 同时给会报错', /错误\[TURNS_INVALID\]/.test(
  await tools.session_export.execute({ sessionId: seeded.id, ranges: '0-1', turns: '2' }),
))
check('越界轮次会报错', /错误\[TURNS_INVALID\]/.test(
  await tools.session_export.execute({ sessionId: seeded.id, turns: '0-30' }),
))

console.log('')
if (failed === 0) {
  console.log('沙盒结果：全部通过 ✔')
} else {
  console.log(`沙盒结果：${failed} 项失败 ✘`)
}
try {
  rmSync(home, { recursive: true, force: true })
  console.log('临时 DSH_HOME 已清理')
} catch {
  console.log('临时 DSH_HOME 清理失败（可手动删除）：' + home)
}
process.exitCode = failed === 0 ? 0 : 1
