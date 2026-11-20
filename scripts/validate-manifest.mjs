/** Manifest and packaged-resource validation (no browser required).
 *
 * Checks the parts of the DSH bundle contract that can be verified statically:
 * bundle patch target, client entry and platform, export targets, packaged files,
 * locale metadata, and icon constraints. It does not verify rendered UI.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS | ${name}${detail ? ' | ' + detail : ''}`)
  } else {
    failed += 1
    console.log(`FAIL | ${name}${detail ? ' | ' + detail : ''}`)
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
check('package name', pkg.name === 'dsh-topic-split', pkg.name)
check('version is semver', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version)
check('engines.node', typeof pkg.engines?.node === 'string', String(pkg.engines?.node))
check('engines.dsh', typeof pkg.engines?.dsh === 'string', String(pkg.engines?.dsh))
check('license', ['GPL-3.0-only', 'GPL-3.0-or-later'].includes(pkg.license), String(pkg.license))

const patch = pkg.dsh?.bundle?.patch
check('bundle patch declared', typeof patch === 'string', String(patch))
check('bundle patch exists', typeof patch === 'string' && existsSync(join(ROOT, patch)), String(patch))

const client = pkg.dsh?.client
check('client platform is web', client?.platform === 'web', String(client?.platform))
check('client entry export declared', typeof pkg.exports?.['./client'] === 'string')
check('client entry exists', existsSync(join(ROOT, 'client/index.js')))

for (const [key, target] of Object.entries(pkg.exports ?? {})) {
  if (key === '.' || target.includes('*')) continue
  check(`export ${key} exists`, existsSync(join(ROOT, target)), target)
}
check('locale export declared', typeof pkg.exports?.['./locale/*.json'] === 'string')
check('icon export declared', typeof pkg.exports?.['./icon'] === 'string')

for (const entry of pkg.files ?? []) {
  const target = join(ROOT, entry)
  check(`files entry exists: ${entry}`, existsSync(target))
}

for (const locale of ['zh', 'en']) {
  const file = join(ROOT, 'locale', `${locale}.json`)
  let meta = null
  try {
    meta = JSON.parse(readFileSync(file, 'utf8')).meta
  } catch {
    meta = null
  }
  check(`locale ${locale} parses`, Boolean(meta))
  check(`locale ${locale} meta.title`, typeof meta?.title === 'string' && meta.title.length > 0)
  check(`locale ${locale} meta.description`, typeof meta?.description === 'string' && meta.description.length > 0)
}

const icon = join(ROOT, 'icon.svg')
if (existsSync(icon)) {
  const size = statSync(icon).size
  const head = readFileSync(icon, 'utf8').trimStart()
  check('icon size <= 256 KiB', size <= 256 * 1024, `${size} bytes`)
  check('icon is SVG', head.startsWith('<svg'), head.slice(0, 12))
}

const inside = (target) => {
  const rel = relative(ROOT, target)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\')
}
check('icon path inside package', inside(icon))
check('no compatibility field (unread by DSH)', pkg.dsh?.compatibility === undefined)

console.log('')
console.log(failed === 0 ? 'manifest: PASS' : `manifest: ${failed} failure(s)`)
process.exitCode = failed === 0 ? 0 : 1
