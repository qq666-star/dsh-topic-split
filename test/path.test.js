import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { makeHome } from './helpers.js'

const home = makeHome()

const { assertInsideRoot, isInsideRoot, samePath, sessionsRoot } = await import('../src/store.js')

test('samePath：Windows 大小写不敏感，POSIX 敏感', () => {
  assert.equal(samePath('C:\\Work\\Proj', 'c:\\work\\proj', 'win32'), true)
  assert.equal(samePath('/home/u/Proj', '/home/u/proj', 'linux'), false)
  assert.equal(samePath('/home/u/Proj', '/home/u/Proj', 'linux'), true)
  assert.equal(samePath('/home/u/Proj', '/home/u/Proj/', 'linux'), true)
})

test('samePath：空路径不匹配任何路径', () => {
  assert.equal(samePath('', ''), false)
  assert.equal(samePath(null, 'D:\\x'), false)
  assert.equal(samePath('/tmp', ''), false)
})

test('isInsideRoot：允许自身与子路径，拒绝越界', () => {
  const root = path.resolve('/tmp/root')
  assert.equal(isInsideRoot(root, path.join(root, 'a', 'b'), 'linux'), true)
  assert.equal(isInsideRoot(root, root, 'linux'), true)
  assert.equal(isInsideRoot(root, path.join(root, '..', 'evil'), 'linux'), false)
  assert.equal(isInsideRoot(root, path.join(root, 'a'), 'win32'), true)
})

test('assertInsideRoot：按平台比较大小写', () => {
  const root = sessionsRoot()
  const inside = path.join(root, 'ws', 'session-x', 'session.v4.jsonl.zstd')
  assert.doesNotThrow(() => assertInsideRoot(inside, 'linux'))
  assert.doesNotThrow(() => assertInsideRoot(inside.toUpperCase(), 'win32'))
  assert.throws(() => assertInsideRoot(inside.toUpperCase(), 'linux'))
  assert.throws(() => assertInsideRoot(path.join(root, '..', 'evil'), 'linux'))
})

test.after(() => home.cleanup())
