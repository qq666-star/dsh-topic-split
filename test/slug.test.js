import test from 'node:test'
import assert from 'node:assert/strict'

const { slugFor } = await import('../src/store.js')

// 基准值由 DSH 的 projectKey 逐字实现生成（dsh-session-persistence-jsonl）
const CASES = [
  ['D:\\DSH-Workspace', '--D-DSH-Workspace--'],
  ['/home/user/project', '--home-user-project--'],
  ['/home/user/my project', '--home-user-my~0020project--'],
  ['/数据/项目', '--~6570~636E-~9879~76EE--'],
  ['/a~b', '--a~007Eb--'],
  ['D:\\', '--D---'],
  ['//server/share', '--server-share--'],
  ['C:\\Program Files\\App', '--C-Program~0020Files-App--'],
  ['relative/dir', '--relative-dir--'],
]

test('项目目录键与 DSH projectKey 一致', () => {
  for (const [input, expected] of CASES) {
    assert.equal(slugFor(input), expected, input)
  }
})

test('Windows 简单路径保持不变（向后兼容）', () => {
  assert.equal(slugFor('D:\\DSH-Workspace'), '--D-DSH-Workspace--')
  assert.equal(slugFor('D:\\TEST-WS'), '--D-TEST-WS--')
})

test('分隔符连续出现只折叠成一个连字符', () => {
  assert.equal(slugFor('a///b:::c\\\\d'), '--a-b-c-d--')
})

test('空路径回退 root', () => {
  assert.equal(slugFor(''), '--root--')
  assert.equal(slugFor(null), '--root--')
  assert.equal(slugFor(undefined), '--root--')
})

test('超长路径截断到 251 字符（总长 255）', () => {
  const long = '/x' + 'a'.repeat(300)
  const out = slugFor(long)
  assert.equal(out.length, 255)
  assert.ok(out.startsWith('--x'))
  assert.ok(out.endsWith('--'))
})

test('输出只含安全字符且以 -- 包裹', () => {
  const samples = CASES.map((c) => c[0]).concat(['/中文 空格/emoji😀', 'C:\\a b\\~c'])
  for (const input of samples) {
    const out = slugFor(input)
    assert.ok(out.startsWith('--'), input)
    assert.ok(out.endsWith('--'), input)
    assert.match(out, /^[A-Za-z0-9._~-]+$/, input)
    assert.ok(out.length <= 255, input)
  }
})
