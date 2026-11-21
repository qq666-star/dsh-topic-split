/** 自愈：被改名的归档目录必须恢复成 `session-<id>`，否则 DSH 会话列表整份报错。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dirname, join } from 'node:path'

import { makeHome } from './helpers.js'

const home = makeHome()

const { createSession } = await import('../src/exporter.js')
const { listSessions } = await import('../src/store.js')
const { repairArchivedDirs } = await import('../src/repair.js')

const log = { warn() {} }

test('把 .archived-session-* 目录改回 session-*', () => {
  const made = createSession({ cwd: 'D:\\REPAIR-WS', pairs: [['u0', 'a0']] })
  const sourceDir = dirname(made.file)
  const workspaceDir = dirname(sourceDir)
  const renamed = join(workspaceDir, `.archived-${made.id}-2026-01-01T00-00-00-000Z`)
  fs.renameSync(sourceDir, renamed)
  assert.equal(listSessions().some((s) => s.dirName === made.id), false)

  const repaired = repairArchivedDirs({ log })
  assert.equal(repaired.length, 1)
  assert.equal(repaired[0].id, made.id)
  assert.equal(fs.existsSync(sourceDir), true)
  assert.equal(listSessions().some((s) => s.dirName === made.id), true)
})

test('目标目录已存在时跳过，不覆盖', () => {
  const made = createSession({ cwd: 'D:\\REPAIR-WS2', pairs: [['u0', 'a0']] })
  const sourceDir = dirname(made.file)
  const workspaceDir = dirname(sourceDir)
  const renamed = join(workspaceDir, `.archived-${made.id}-2026-01-02T00-00-00-000Z`)
  fs.renameSync(sourceDir, renamed)
  fs.mkdirSync(sourceDir)

  const repaired = repairArchivedDirs({ log })
  assert.equal(repaired.length, 0)
  assert.equal(fs.existsSync(renamed), true)
})

test('没有改名目录时什么都不做', () => {
  const before = listSessions().length
  assert.deepEqual(repairArchivedDirs({ log }), [])
  assert.equal(listSessions().length, before)
})

test.after(() => home.cleanup())
