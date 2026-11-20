#!/usr/bin/env node
/**
 * 修改 profile 的 package.json：登记/移除插件。
 *
 *   node scripts/profile-manifest.mjs add    <manifestPath> <pluginRoot>
 *   node scripts/profile-manifest.mjs remove <manifestPath>
 *   node scripts/profile-manifest.mjs check  <manifestPath>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// 从 package.json 读名字，避免改名后脚本仍指向旧包
const PLUGIN = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).name
const [command, manifestPath, pluginRoot] = process.argv.slice(2)

function fail(message) {
  console.error(`profile-manifest: ${message}`)
  process.exit(1)
}

if (!command || !manifestPath) fail('用法: <add|remove|check> <manifestPath> [pluginRoot]')

let pkg
try {
  pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  fail(`无法读取 ${manifestPath}: ${err.message}`)
}

const bundles = () => {
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  pkg.dsh.profile.bundles ??= []
  return pkg.dsh.profile.bundles
}

if (command === 'add') {
  if (!pluginRoot) fail('add 需要 pluginRoot')
  pkg.dependencies ??= {}
  pkg.dependencies[PLUGIN] = 'file:' + pluginRoot.replace(/\\/g, '/')
  const list = bundles()
  if (!list.includes(PLUGIN)) list.push(PLUGIN)
} else if (command === 'remove') {
  if (pkg.dependencies) delete pkg.dependencies[PLUGIN]
  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PLUGIN)
  }
} else if (command === 'check') {
  const registered = Boolean(pkg.dependencies?.[PLUGIN])
  const bundled = Boolean(pkg.dsh?.profile?.bundles?.includes(PLUGIN))
  console.log(JSON.stringify({ registered, bundled }))
  process.exit(registered && bundled ? 0 : 1)
} else {
  fail(`未知命令: ${command}`)
}

writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
JSON.parse(readFileSync(manifestPath, 'utf8')) // 回读校验
console.log(`profile-manifest: ${command} 完成 -> ${manifestPath}`)
