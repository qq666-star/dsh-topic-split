import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client', 'index.js'), 'utf8')

/** 只校验模块与注册契约，不渲染 React、不模拟 DOM 交互。 */
function loadClient() {
  let entry = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          entry = value
        },
      },
    },
    console: { log() {}, warn() {} },
  }
  vm.runInNewContext(source, sandbox, { filename: 'client/index.js' })
  return { entry, sandbox }
}

const React = {
  createElement: (...args) => ({ args }),
  Fragment: Symbol('Fragment'),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useState: (value) => [value, () => {}],
}
const ReactDom = { createPortal: (node) => node }

function makeCtx() {
  const calls = { locale: null, slot: null, effects: [] }
  return {
    calls,
    ctx: {
      effect(fn, label) {
        const cleanup = fn()
        calls.effects.push({ label, cleanup })
        return () => {
          if (typeof cleanup === 'function') cleanup()
        }
      },
      locale: {
        register(ns, dicts) {
          calls.locale = { ns, dicts }
          return () => {}
        },
        bind() {
          return (key) => key
        },
      },
      slots: {
        inject(key, callback) {
          calls.slot = { key }
          calls.slot.disposer = callback()
          return () => {}
        },
        register(spec, Component) {
          calls.slot.spec = spec
          calls.slot.Component = Component
          return () => {}
        },
      },
    },
  }
}

test('模块导出、slot 与 locale 注册契约', () => {
  const { entry } = loadClient()
  assert.ok(entry, '必须调用 __ModuleLoader__.load')
  assert.equal(entry.id, 'dsh-topic-split')

  const mod = entry.factory((name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDom
    throw new Error('unexpected require: ' + name)
  })
  assert.deepEqual(Array.from(mod.inject), ['slots', 'locale'])
  assert.equal(typeof mod.apply, 'function')

  const { ctx, calls } = makeCtx()
  mod.apply(ctx)

  assert.equal(calls.slot.key, 'conversation.input.dock')
  assert.equal(calls.slot.spec.name, 'conversation.input.dock')
  assert.equal(calls.slot.spec.id, 'dsh-topic-split')
  assert.equal(typeof calls.slot.spec.inject, 'function')
  assert.deepEqual({ ...calls.slot.spec.inject('abc') }, { sessionId: 'abc' })
  assert.deepEqual({ ...calls.slot.spec.inject(undefined) }, {})
  assert.equal(typeof calls.slot.Component, 'function')

  assert.equal(calls.locale.ns, 'dsh-topic-split')
  assert.deepEqual(Object.keys(calls.locale.dicts).sort(), ['en', 'zh'])
  assert.deepEqual(
    Object.keys(calls.locale.dicts.zh).sort(),
    Object.keys(calls.locale.dicts.en).sort(),
    'zh/en 字典键必须一致',
  )
})

test('客户端源码不含宿主 DOM 探查与 body 直插', () => {
  assert.doesNotMatch(source, /document\.querySelector\(\s*['"]\[aria-label/)
  assert.doesNotMatch(source, /insertAdjacentElement/)
  assert.doesNotMatch(source, /document\.body\.append/)
  assert.doesNotMatch(source, /new MutationObserver/)
  assert.doesNotMatch(source, /\bvar\s+/)
  assert.match(source, /createPortal/)
})

test('缺少 module loader 时安静跳过，不抛错', () => {
  const warnings = []
  const sandbox = { window: {}, console: { warn: (...args) => warnings.push(args.join(' ')) } }
  assert.doesNotThrow(() => vm.runInNewContext(source, sandbox, { filename: 'client/index.js' }))
  assert.ok(warnings.some((line) => line.includes('module loader missing')))
})

test('factory 依赖缺失时返回 inert 模块', () => {
  const { entry } = loadClient()
  const mod = entry.factory(() => {
    throw new Error('react missing')
  })
  assert.deepEqual(Array.from(mod.inject), [])
  assert.equal(typeof mod.apply, 'function')
  assert.doesNotThrow(() => mod.apply({}))
})
