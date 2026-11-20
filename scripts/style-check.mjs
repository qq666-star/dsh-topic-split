#!/usr/bin/env node
/**
 * 零依赖代码规范检查（替代 ESLint 的最小可用集合）。
 *
 * 规则：
 *   R1  禁止 var
 *   R2  禁止 == / !=（必须 === / !==）
 *   R3  禁止 debugger
 *   R4  禁止行尾空白、Tab 缩进、CRLF
 *   R5  文件必须以单个换行结尾
 *   R6  单行不超过 120 字符
 *   R7  src/ 与 client/ 中禁止 console.log（日志统一走 log.js / 受控输出）
 *   R8  src/ 中 `export function|const|class` 必须有 JSDoc 注释
 *   R9  文件名必须 kebab-case（scripts 允许 .mjs）
 *
 * 用法：
 *   node scripts/style-check.mjs            # 检查
 *   node scripts/style-check.mjs --list     # 顺便列出检查的文件
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MAX_LINE = 120
const SCAN_DIRS = ['src', 'client', 'test', 'scripts']
const ALLOW_CONSOLE = new Set(['src/log.js', 'client/index.js', 'scripts/style-check.mjs'])

const problems = []
const report = (file, line, rule, message) => problems.push({ file, line, rule, message })

/** 粗略剥离字符串与注释，避免误报。 */
function stripCode(line) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < line.length) {
    const ch = line[i]
    const next = line[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') {
        state = 'block'
        i += 2
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch
        i += 1
        continue
      }
      out += ch
      i += 1
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        i += 2
        continue
      }
      i += 1
      continue
    }
    // 字符串内部
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === state) state = 'code'
    i += 1
  }
  return out
}

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else if (extname(name) === '.js' || extname(name) === '.mjs') files.push(full)
  }
  return files
}

function checkFile(full) {
  const rel = relative(ROOT, full).replace(/\\/g, '/')
  const raw = readFileSync(full, 'utf8')
  const base = rel.split('/').pop()

  // R9 文件名
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(base)) {
    report(rel, 0, 'R9', `文件名必须是 kebab-case：${base}`)
  }

  // R5 结尾换行
  if (!raw.endsWith('\n') || raw.endsWith('\n\n')) {
    report(rel, 0, 'R5', '文件必须以单个换行结尾')
  }

  // R4 CRLF
  if (raw.includes('\r\n')) report(rel, 0, 'R4', '必须使用 LF 换行，不能有 CRLF')

  const lines = raw.split('\n')
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const rawLine = lines[i]

    // R4 / R6 一律对原始行判定（注释里的内容也要干净）
    if (/[ \t]+$/.test(rawLine)) report(rel, lineNo, 'R4', '行尾有空白')
    if (/^\t/.test(rawLine)) report(rel, lineNo, 'R4', '禁止 Tab 缩进')
    if (rawLine.length > MAX_LINE) report(rel, lineNo, 'R6', `行宽 ${rawLine.length} 超过 ${MAX_LINE}`)

    // 跳过块注释内部（避免注释里的关键字误报）
    if (inBlock) {
      if (rawLine.includes('*/')) inBlock = false
      continue
    }
    if (/^\s*\/\*/.test(rawLine) && !rawLine.includes('*/')) {
      inBlock = true
      continue
    }

    // 其它规则看剥掉行内块注释后的内容
    const line = rawLine.replace(/\/\*.*?\*\//g, '')
    const code = stripCode(line)
    if (!code.trim()) continue

    if (/\bvar\s+/.test(code)) report(rel, lineNo, 'R1', '禁止使用 var')
    if (/([^=!<>])=="|"\s*==|!=\s*[^=]/.test(code) && !/===|!==/.test(code)) {
      report(rel, lineNo, 'R2', '禁止使用 == / !=')
    }
    if (/\bdebugger\b/.test(code)) report(rel, lineNo, 'R3', '禁止 debugger')

    const isApp = rel.startsWith('src/') || rel.startsWith('client/')
    if (isApp && !ALLOW_CONSOLE.has(rel) && /console\.(log|info|debug)\s*\(/.test(code)) {
      report(rel, lineNo, 'R7', '应用代码中禁止 console.log，请使用 log.js')
    }

    // R8 导出的函数/常量需要 JSDoc
    if (rel.startsWith('src/') && /^export\s+(async\s+)?(function|const|class)\s+\w+/.test(line.trim())) {
      let j = i - 1
      while (j >= 0 && lines[j].trim() === '') j -= 1
      const prev = j >= 0 ? lines[j].trim() : ''
      if (!prev.endsWith('*/')) {
        report(rel, lineNo, 'R8', '导出的函数/常量必须有 JSDoc 注释')
      }
    }
  }
}

const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)))
files.sort()

for (const file of files) checkFile(file)

if (process.argv.includes('--list')) {
  console.log(`检查了 ${files.length} 个文件：`)
  for (const f of files) console.log('  ' + relative(ROOT, f).replace(/\\/g, '/'))
  console.log('')
}

if (problems.length === 0) {
  console.log(`style-check: 通过（${files.length} 个文件，9 条规则）`)
  process.exit(0)
}

const byFile = new Map()
for (const p of problems) {
  const list = byFile.get(p.file) ?? []
  list.push(p)
  byFile.set(p.file, list)
}
for (const [file, list] of byFile) {
  console.log(`\n${file}`)
  for (const p of list) console.log(`  ${file}:${p.line}  [${p.rule}] ${p.message}`)
}
console.log(`\nstyle-check: ${problems.length} 处问题，涉及 ${byFile.size} 个文件`)
process.exit(1)
