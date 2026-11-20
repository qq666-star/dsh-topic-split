/** 诊断信息：路径、缓存命中、配置、运行环境。用于 session_diag 工具与排障。 */
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'

import { dshHome, registryPath, sessionsRoot } from './store.js'
import { listArchivedDirs } from './repair.js'

/**
 * @param {object} input 诊断输入
 * @param {Record<string, any>} input.cfg 已校验配置
 * @param {() => Record<string, number>} input.readerStats 读取器统计
 * @param {string[]} input.toolNames 已注册工具名
 * @param {string} [input.judge] 判断模型描述
 * @param {boolean} [input.redact] 是否隐去主机名与本机路径（HTTP 接口默认脱敏）
 */
export function buildDiagnostics({ cfg, readerStats, toolNames, judge, redact = false }) {
  const stats = readerStats ? readerStats() : {}
  const host = redact ? '<已隐藏>' : hostname()
  const home = redact ? '<已隐藏>' : dshHome()
  const root = redact ? '<已隐藏>' : sessionsRoot()
  const registry = redact ? '<已隐藏>' : registryPath()
  const lines = [
    '会话独立插件 · 诊断',
    '',
    `运行环境：Node ${process.version} · ${host}`,
    `DSH_HOME：${home}`,
    `会话目录：${root}（${redact ? '已隐藏' : existsSync(sessionsRoot()) ? '存在' : '不存在'}）`,
    `注册表：${registry}（${redact ? '已隐藏' : existsSync(registryPath()) ? '存在' : '不存在'}）`,
    '',
    '工具：' + (toolNames.length ? toolNames.join(', ') : '(未注册)'),
    '',
    '配置：',
    `  压缩上限 ${(cfg.maxCompressedBytes / 1024 / 1024).toFixed(0)} MB`
      + ` · 解压上限 ${(cfg.maxInflatedBytes / 1024 / 1024).toFixed(0)} MB`,
    `  缓存 ${cfg.cacheEntries} 条 · 区间上限 ${cfg.maxRanges} 段`,
    `  分段阈值 ${cfg.minSegmentTurns} 轮 / ${cfg.minSegmentChars} 字`,
    `  主题规则 ${cfg.topicRules.length} 组`,
    `  HTTP 面板 ${cfg.httpRoutes === 'token' ? '已启用（需令牌）' : '已关闭（配置）'}`
      + ` · 标题 ${cfg.exposeTitles ? '可见' : '隐藏'}`,
    '',
    '判断模型：',
    `  后端 ${cfg.semantic.backend} · ${judge ?? '不可用（回退关键词规则）'}`,
    `  内核路由 ${cfg.semantic.provider}/${cfg.semantic.model}`
      + ` · 超时 ${cfg.semantic.timeoutMs} ms · 重试 ${cfg.semantic.retries}`,
    '',
    '缓存统计：',
    `  命中 ${stats.hits ?? 0} 次 · 未命中 ${stats.misses ?? 0} 次 · 最近解析 ${stats.lastParseMs ?? 0} ms`,
    '',
    '归档目录：',
    archivedDirLine(redact),
    '',
    '开关：',
    `  DSH_SESSION_SPLIT_DISABLE=${process.env.DSH_SESSION_SPLIT_DISABLE ?? '(未设置)'}`,
    `  DSH_SESSION_SPLIT_DEBUG=${process.env.DSH_SESSION_SPLIT_DEBUG ?? '(未设置)'}`,
    `  DSH_SESSION_SPLIT_JUDGE=${process.env.DSH_SESSION_SPLIT_JUDGE ?? '(未设置)'}`,
    `  DSH_SESSION_SPLIT_HTTP=${process.env.DSH_SESSION_SPLIT_HTTP ?? '(未设置)'}`,
  ]
  return lines.join('\n')
}

/**
 * 归档目录一行：残留的 `.archived-*` 会让 DSH 的会话列表整份读不出来。
 * @param {boolean} redact 是否脱敏（不列本机目录名）
 * @returns {string}
 */
function archivedDirLine(redact) {
  if (redact) return '  已隐藏'
  const stray = listArchivedDirs()
  if (stray.length === 0) return '  无残留（.archived-* 目录会让 DSH 会话列表整份读不出来）'
  return `  ⚠ 发现 ${stray.length} 个被改名的目录：${stray.map((entry) => entry.name).join(', ')}`
}
