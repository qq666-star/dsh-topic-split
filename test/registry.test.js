import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { makeHome } from './helpers.js'

const home = makeHome()

const { createRegistrar } = await import('../src/registry.js')
const { registryPath } = await import('../src/store.js')

function writeRegistry(ids) {
  const file = registryPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({
      global: {},
      tables: { workspaces: { w1: { path: 'D:\\X', title: 'X', sessionIds: ids } } },
    }),
  )
}

function readIds() {
  const reg = JSON.parse(fs.readFileSync(registryPath(), 'utf8'))
  return reg.tables.workspaces.w1.sessionIds
}

function readArchived() {
  const reg = JSON.parse(fs.readFileSync(registryPath(), 'utf8'))
  return reg.global?.archivedSessionIds ?? []
}

test('有 workspaceRegistry 服务时走 attach/detach', async () => {
  const calls = []
  const ws = {
    attachSession: async (id) => calls.push(['attach', id]),
    detachSession: async (id) => calls.push(['detach', id]),
  }
  const ctx = { workspaceRegistry: { resolveByPath: async () => ws } }
  const registrar = createRegistrar({ ctx })
  assert.equal(registrar.mode, 'service')
  await registrar.register('D:\\X', 'session-a')
  await registrar.unregister('D:\\X', 'session-a')
  assert.deepEqual(calls, [
    ['attach', 'session-a'],
    ['detach', 'session-a'],
  ])
})

test('服务失败时回退文件，且只增删目标 id', async () => {
  writeRegistry(['session-old'])
  const broken = { attachSession: async () => { throw new Error('boom') } }
  const ctx = { workspaceRegistry: { resolveByPath: async () => broken } }
  const registrar = createRegistrar({ ctx, log: { warn() {} } })
  await registrar.register('D:\\X', 'session-new')
  assert.deepEqual(readIds(), ['session-new', 'session-old'])
  await registrar.unregister('D:\\X', 'session-new')
  assert.deepEqual(readIds(), ['session-old'])
})

test('没有服务时走文件兜底并保留其它条目', async () => {
  writeRegistry(['session-a', 'session-b'])
  const registrar = createRegistrar({ ctx: null })
  assert.equal(registrar.mode, 'file')
  await registrar.register('D:\\X', 'session-c')
  assert.deepEqual(readIds(), ['session-c', 'session-a', 'session-b'])
  await registrar.unregister('D:\\X', 'session-c')
  assert.deepEqual(readIds(), ['session-a', 'session-b'])
})

test('有服务时归档走 workspaceRegistry.archiveSession，不注销、不改目录', async () => {
  const calls = []
  const ctx = {
    workspaceRegistry: {
      resolveByPath: async () => ({
        attachSession: async () => {},
        detachSession: async () => calls.push('detach'),
      }),
      archiveSession: async (id) => calls.push(['archive', id]),
    },
  }
  const registrar = createRegistrar({ ctx })
  assert.equal(await registrar.archive('D:\\X', 'session-a'), 'service')
  assert.deepEqual(calls, [['archive', 'session-a']])
})

test('归档被 DSH 拒绝时直接报错，不退回改名也不退回写文件', async () => {
  writeRegistry(['session-a'])
  const ctx = {
    workspaceRegistry: {
      resolveByPath: async () => ({}),
      archiveSession: async () => {
        throw new Error('the session is active')
      },
    },
  }
  const registrar = createRegistrar({ ctx, log: { warn() {} } })
  await assert.rejects(() => registrar.archive('D:\\X', 'session-a'), /active/)
  assert.deepEqual(readArchived(), [])
})

test('没有服务时归档写 archivedSessionIds（只增，保留已有条目）', async () => {
  writeRegistry(['session-a', 'session-b'])
  const registrar = createRegistrar({ ctx: null })
  assert.equal(await registrar.archive('D:\\X', 'session-b'), 'file')
  assert.deepEqual(readArchived(), ['session-b'])
  assert.deepEqual(readIds(), ['session-a', 'session-b'])
})

test.after(() => home.cleanup())
