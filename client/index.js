/**
 * dsh-topic-split — Client 半（v0.12：slot + React + locale）
 *
 * 合规要点：
 *   - 通过 conversation.input.dock slot 注册 React 组件，不读写宿主 DOM、不 append document.body
 *   - 固定浮层按宿主文档要求用 createPortal 挂到 body
 *   - 可见文案全部走 ctx.locale；颜色全部走 --dsw-alias-* 主题 token
 *   - 组件卸载时移除监听与定时器；不启动第二个应用
 */
;(function () {
  'use strict'

  const NS = 'dsh-topic-split'
  const TAG = '[dsh-topic-split]'
  const API = '/dsh-topic-split'
  const SLOT = 'conversation.input.dock'

  /** 中文用户看到双语；英文用户看到纯英文。 */
  const ZH = {
    chip: '拆分 / Split',
    chipTitle: '拆分会话：按主题或轮次导出独立会话',
    title: '按主题拆分会话 / Split by topic',
    close: '关闭 / Close',
    s1: '1. 选择会话 / Choose a session',
    s2: '2. 分段方式 / Segmentation',
    s3: '3. 选择内容 / Select content',
    s4: '4. 手动添加（可选） / Add manually',
    s5: '5. 导出分组 / Output groups',
    s6: '6. 预览与导出 / Preview & export',
    refresh: '刷新 / Refresh',
    loadTopics: '获取分段 / Load segments',
    modeAuto: '自动（模型优先） / Auto',
    modeKeyword: '关键词规则 / Keywords',
    modeModel: '强制模型 / Force model',
    selectAll: '全选 / Select all',
    clear: '清空 / Clear',
    merge: '合并为一组 / Merge',
    each: '各成一组 / Split each',
    modeRanges: '连续区间 / Ranges',
    modeTurns: '精确轮次 / Exact turns',
    addGroup: '添加分组 / Add group',
    hintRanges: '例如 0-51,52-96',
    hintTurns: '例如 3,7-9,20（散点会缺少中间上下文）',
    remove: '删除 / Remove',
    cut: '导出后从原会话剪除并归档 / Remove & archive',
    cutHint: '原会话归档；主会话由剩余轮次新建（只保留文字）。需先预览。',
    preview: '预览 / Preview',
    export: '导出为独立会话 / Export',
    exportCut: '导出并剪除 / Export & remove',
    previewFirst: '请先预览 / Preview first',
    titleTip: '标题 / Title',
    turnsTip: '轮次 / Turns',
    charsTip: '字 / Chars',
    selectedTip: '已选 / Selected',
    coverageOk: '覆盖率一致 / Coverage ok',
    coverageBad: '覆盖率不一致 / Coverage mismatch',
    coveragePartial: '本次选择覆盖 / Selected coverage',
    duplicateTip: '重叠 / Duplicate',
    groupsTip: '分组 / Groups',
    sessionsTip: '会话 / Sessions',
    totalTip: '合计 / Total',
    none: '（无） / (none)',
    segmentsEmpty: '先点「获取分段」 / Load segments first',
    groupsEmpty: '还没有分组 / No groups yet',
    loadingSessions: '正在读取会话… / Loading sessions…',
    loadingTopics: '正在分段… / Loading segments…',
    previewing: '正在预览… / Previewing…',
    exporting: '正在导出… / Exporting…',
    created: '已创建 / Created',
    rebuilt: '已重建主会话 / Rebuilt main',
    archivedYes: '原会话已归档 / Source archived',
    archivedNo: '原会话未归档（可能仍在运行） / Source not archived (may be running)',
    cutKeeps: '剪除后主会话保留 / Main keeps',
    cutNext:
      '请到侧栏打开新的主会话；当前页面仍属于已归档的原会话 / ' +
      'Open the rebuilt main session from the sidebar; this view is still the archived source.',
    rangeTooMany: '区间或分组过多 / Too many ranges or groups',
    emptyResult: '结果为空（可能剪掉了全部内容）/ Result would be empty',
    sessionGone: '会话不存在，请刷新 / Session not found, refresh',
    judgeUnavailable: '判断模型不可用 / Judge model unavailable',
    fileCorrupt: '会话文件损坏 / Session file is corrupt',
    configInvalid: '插件配置非法 / Invalid plugin configuration',
    unknown: '未知错误 / Unknown error',
    turnsUnit: '轮',
    charsUnit: '字',
    segmentsUnit: '段',
    sourceRanges: '区间 / Ranges',
    sourceTurns: '轮次 / Turns',
    unauthorized: '未授权，请刷新页面 / Unauthorized, refresh the page',
    forbidden: '仅允许本机访问 / Local access only',
    tooMany: '请求过于频繁 / Too many requests',
    apiDisabled: '面板接口未启用（httpRoutes=off） / Panel API disabled',
    invalidRanges: '区间格式应为 0-51 或 0-51,52-96 / Ranges: 0-51 or 0-51,52-96',
    invalidTurns: '轮次格式应为 3,7-9,20 / Turns: 3,7-9,20',
    needGroup: '请先添加至少一个分组 / Add at least one group',
    needSession: '请先选择会话 / Choose a session first',
    done: '完成 / Done',
    error: '错误 / Error',
  }

  const EN = {
    chip: 'Split',
    chipTitle: 'Split by topic or exact turns into independent sessions',
    title: 'Split by topic',
    close: 'Close',
    s1: '1. Choose a session',
    s2: '2. Segmentation',
    s3: '3. Select content',
    s4: '4. Add manually (optional)',
    s5: '5. Output groups',
    s6: '6. Preview & export',
    refresh: 'Refresh',
    loadTopics: 'Load segments',
    modeAuto: 'Auto (model first)',
    modeKeyword: 'Keywords',
    modeModel: 'Force model',
    selectAll: 'Select all',
    clear: 'Clear',
    merge: 'Merge',
    each: 'Split each',
    modeRanges: 'Ranges',
    modeTurns: 'Exact turns',
    addGroup: 'Add group',
    hintRanges: 'e.g. 0-51,52-96',
    hintTurns: 'e.g. 3,7-9,20 (scattered turns lose context)',
    remove: 'Remove',
    cut: 'Remove & archive after export',
    cutHint: 'The source is archived; the main session is rebuilt from the remaining turns (text only). Preview first.',
    preview: 'Preview',
    export: 'Export',
    exportCut: 'Export & remove',
    previewFirst: 'Preview first',
    titleTip: 'Title',
    turnsTip: 'Turns',
    charsTip: 'Chars',
    selectedTip: 'Selected',
    coverageOk: 'Coverage ok',
    coverageBad: 'Coverage mismatch',
    coveragePartial: 'Selected coverage',
    duplicateTip: 'Duplicate',
    groupsTip: 'Groups',
    sessionsTip: 'Sessions',
    totalTip: 'Total',
    none: '(none)',
    segmentsEmpty: 'Load segments first',
    groupsEmpty: 'No groups yet',
    loadingSessions: 'Loading sessions…',
    loadingTopics: 'Loading segments…',
    previewing: 'Previewing…',
    exporting: 'Exporting…',
    created: 'Created',
    rebuilt: 'Rebuilt main',
    archivedYes: 'Source archived',
    archivedNo: 'Source not archived (may be running)',
    cutKeeps: 'Main keeps',
    cutNext: 'Open the rebuilt main session from the sidebar; this view is still the archived source.',
    rangeTooMany: 'Too many ranges or groups',
    emptyResult: 'Result would be empty',
    sessionGone: 'Session not found, refresh',
    judgeUnavailable: 'Judge model unavailable',
    fileCorrupt: 'Session file is corrupt',
    configInvalid: 'Invalid plugin configuration',
    unknown: 'Unknown error',
    turnsUnit: 'turns',
    charsUnit: 'chars',
    segmentsUnit: 'segments',
    sourceRanges: 'Ranges',
    sourceTurns: 'Turns',
    unauthorized: 'Unauthorized, refresh the page',
    forbidden: 'Local access only',
    tooMany: 'Too many requests',
    apiDisabled: 'Panel API disabled (httpRoutes=off)',
    invalidRanges: 'Ranges must look like 0-51 or 0-51,52-96',
    invalidTurns: 'Turns must look like 3,7-9,20',
    needGroup: 'Add at least one group',
    needSession: 'Choose a session first',
    done: 'Done',
    error: 'Error',
  }

  // ---------------------------------------------------------------- 纯函数

  const fmt = (n) => Number(n).toLocaleString('en-US')

  const isRanges = (value) => /^\d+-\d+(,\d+-\d+)*$/.test(value)
  const isTurns = (value) => /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value)

  const runsText = (runs) =>
    Array.isArray(runs) ? runs.map((run) => (run[0] === run[1] ? `${run[0]}` : run.join('-'))).join(', ') : ''

  const token = () => {
    try {
      const meta = document.querySelector('meta[name="dsh-split-token"]')
      if (meta && meta.getAttribute('content')) return meta.getAttribute('content')
      return window.localStorage.getItem('dsh-split-token') || ''
    } catch {
      return ''
    }
  }

  async function api(path, options) {
    const headers = { 'content-type': 'application/json' }
    const value = token()
    if (value) headers['x-dsh-split-token'] = value
    const res = await fetch(API + path, { headers, ...options })
    let body = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const failure = (code, message) => {
      const err = new Error(message)
      err.code = code
      return err
    }
    if (res.status === 401) throw failure('UNAUTHORIZED', 'unauthorized')
    if (res.status === 403) throw failure('FORBIDDEN', 'forbidden')
    if (res.status === 429) throw failure('RATE_LIMITED', 'rate limited')
    if (!body) throw failure('API_DISABLED', 'api disabled')
    if (body.ok !== true) throw failure(body.code || 'ERROR', body.error || `HTTP ${res.status}`)
    return body.value
  }

  // ---------------------------------------------------------------- 样式

  const panelStyle = {
    position: 'fixed',
    right: 16,
    bottom: 96,
    width: 'min(460px, calc(100vw - 32px))',
    maxHeight: '76vh',
    overflowY: 'auto',
    zIndex: 1000,
    background: 'var(--dsw-alias-bg-layer-2, #1c1f26)',
    color: 'var(--dsw-alias-label-primary, #e8e8ea)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))',
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.55,
    boxShadow: '0 12px 40px rgba(0, 0, 0, .35)',
    boxSizing: 'border-box',
  }

  const sectionStyle = {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid var(--dsw-alias-separator-primary, rgba(255,255,255,.08))',
  }

  const headingStyle = {
    fontWeight: 600,
    color: 'var(--dsw-alias-label-secondary, #cfd6e0)',
    marginBottom: 5,
  }

  const rowStyle = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }

  const inputStyle = {
    flex: 1,
    minWidth: 0,
    background: 'var(--dsw-alias-bg-layer-1, #14161b)',
    color: 'var(--dsw-alias-label-primary, #e8e8ea)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18))',
    borderRadius: 6,
    padding: '4px 6px',
    fontSize: 12,
  }

  const mutedStyle = { color: 'var(--dsw-alias-label-tertiary, #9aa0aa)' }

  const listStyle = { margin: '4px 0' }

  const outputStyle = {
    margin: '8px 0 0',
    padding: 8,
    background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.25))',
    borderRadius: 6,
    whiteSpace: 'pre-wrap',
    fontSize: 11,
  }

  const buttonStyle = (primary, danger) => ({
    background: danger
      ? 'var(--dsw-alias-state-error-secondary, rgba(255,90,90,.12))'
      : primary
        ? 'color-mix(in srgb, var(--dsw-alias-button-primary-fill, #58a6ff) 18%, transparent)'
        : 'transparent',
    color: danger ? 'var(--dsw-alias-state-error-primary, #ff8a8a)' : 'var(--dsw-alias-label-primary, #e8e8ea)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2))',
    borderRadius: 6,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
  })

  // ---------------------------------------------------------------- 组件

  function createDock(React, createPortal, getTranslate) {
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    function Section(props) {
      const title = { ...headingStyle, margin: '0 0 5px', fontSize: 12 }
      return h(
        'div',
        { style: sectionStyle },
        h('h3', { role: 'heading', 'aria-level': 3, style: title }, props.title),
        props.children,
      )
    }

    function errorText(t, err) {
      const map = {
        UNAUTHORIZED: t('unauthorized'),
        FORBIDDEN: t('forbidden'),
        RATE_LIMITED: t('tooMany'),
        API_DISABLED: t('apiDisabled'),
        TURNS_INVALID: t('invalidTurns'),
        RANGE_INVALID: t('invalidRanges'),
        RANGE_TOO_MANY: t('rangeTooMany'),
        EMPTY_RESULT: t('emptyResult'),
        SESSION_NOT_FOUND: t('sessionGone'),
        JUDGE_UNAVAILABLE: t('judgeUnavailable'),
        FILE_CORRUPT: t('fileCorrupt'),
        CONFIG_INVALID: t('configInvalid'),
      }
      const code = err && err.code ? String(err.code) : ''
      const text = map[code] || `${t('unknown')} (${code || 'ERR'})`
      return `${t('error')}: ${text}`
    }

    return function TopicSplitDock(props) {
      const t = getTranslate()
      const currentId = String(props.sessionId || (props.session && props.session.id) || '')
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState('')
      const [output, setOutput] = useState('')
      const [sessions, setSessions] = useState([])
      const [sessionId, setSessionId] = useState(currentId)
      const hostSessionRef = useRef(currentId)
      const [mode, setMode] = useState('auto')
      const [turns, setTurns] = useState(0)
      const [segments, setSegments] = useState([])
      const [coverage, setCoverage] = useState(null)
      const [selected, setSelected] = useState([])
      const [groups, setGroups] = useState([])
      const [addMode, setAddMode] = useState('ranges')
      const [spec, setSpec] = useState('')
      const [cut, setCut] = useState(false)
      const [previewed, setPreviewed] = useState(false)
      const chipRef = useRef(null)
      const panelRef = useRef(null)

      const resetPlan = useCallback(() => {
        setSegments([])
        setCoverage(null)
        setSelected([])
        setGroups([])
        setPreviewed(false)
        setStatus('')
        setOutput('')
      }, [])

      // 只在“宿主当前会话”发生变化时同步，避免手动选择源会话被立刻重置
      useEffect(() => {
        if (hostSessionRef.current === currentId) return
        hostSessionRef.current = currentId
        if (currentId) {
          setSessionId(currentId)
          resetPlan()
        }
      }, [currentId, resetPlan])

      const close = useCallback(
        (restoreFocus = true) => {
          setOpen(false)
          if (restoreFocus && chipRef.current) chipRef.current.focus()
        },
        [],
      )

      useEffect(() => {
        if (!open) return undefined
        if (panelRef.current) panelRef.current.focus()
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }
        const onDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (chipRef.current && chipRef.current.contains(target)) return
          close(false)
        }
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('mousedown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          document.removeEventListener('mousedown', onDown, true)
        }
      }, [open, close])

      const loadSessions = useCallback(async () => {
        setBusy(true)
        setStatus(t('loadingSessions'))
        try {
          const rows = await api('/sessions')
          setSessions(rows)
          const current = rows.some((row) => row.id === sessionId) ? sessionId : rows[0]?.id || ''
          if (current !== sessionId) resetPlan()
          setSessionId(current)
          setStatus(`${t('sessionsTip')}: ${rows.length}`)
          return rows
        } catch (err) {
          setStatus(errorText(t, err))
          return []
        } finally {
          setBusy(false)
        }
      }, [sessionId, t, resetPlan])

      const openPanel = useCallback(() => {
        setOpen(true)
        setOutput('')
        loadSessions()
      }, [loadSessions])

      const switchSession = (id) => {
        setSessionId(id)
        resetPlan()
      }

      const loadTopics = async () => {
        if (!sessionId) return setStatus(t('needSession'))
        setBusy(true)
        setStatus(t('loadingTopics'))
        try {
          const query = `?sessionId=${encodeURIComponent(sessionId)}&mode=${mode}`
          const value = await api('/topics' + query)
          setTurns(value.turns)
          setSegments(value.segments)
          setCoverage(value.coverage)
          setSelected([])
          setPreviewed(false)
          setStatus(
            `${value.turns} ${t('turnsUnit')} · ${value.segments.length} ${t('segmentsUnit')} · ` +
              (value.coverage?.ok ? t('coverageOk') : t('coverageBad')),
          )
        } catch (err) {
          setStatus(errorText(t, err))
        } finally {
          setBusy(false)
        }
      }

      const toggleSegment = (index) => {
        setSelected((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index]))
        setPreviewed(false)
      }

      const rangesOf = (indices) => {
        const picked = indices.map((i) => segments[i]).sort((a, b) => a.from - b.from)
        return picked.map((s) => `${s.from}-${s.to}`).join(',')
      }

      const addGroup = (group) => {
        setGroups((list) => [...list, group])
        setPreviewed(false)
      }

      const mergeSelected = () => {
        if (selected.length === 0) return setStatus(t('needGroup'))
        const indices = [...selected].sort((a, b) => a - b)
        const title = indices
          .map((i) => segments[i].label)
          .join(' + ')
          .slice(0, 40)
        addGroup({ title, mode: 'ranges', spec: rangesOf(indices) })
        setSelected([])
        setStatus(t('done'))
      }

      const eachSelected = () => {
        if (selected.length === 0) return setStatus(t('needGroup'))
        const next = [...selected]
          .sort((a, b) => a - b)
          .map((i) => ({
            title: segments[i].label.slice(0, 40),
            mode: 'ranges',
            spec: `${segments[i].from}-${segments[i].to}`,
          }))
        setGroups((list) => [...list, ...next])
        setSelected([])
        setPreviewed(false)
        setStatus(t('done'))
      }

      const addManual = () => {
        const value = spec.trim()
        const ok = addMode === 'ranges' ? isRanges(value) : isTurns(value)
        if (!ok) return setStatus(addMode === 'ranges' ? t('invalidRanges') : t('invalidTurns'))
        addGroup({ title: value.slice(0, 30), mode: addMode, spec: value })
        setSpec('')
        setStatus(t('done'))
      }

      const removeGroup = (index) => {
        setGroups((list) => list.filter((_, i) => i !== index))
        setPreviewed(false)
      }

      const payload = useMemo(
        () => ({
          sessionId,
          cut,
          groups: groups.map((group) => ({
            title: group.title,
            ranges: group.mode === 'ranges' ? group.spec : undefined,
            turns: group.mode === 'turns' ? group.spec : undefined,
          })),
        }),
        [sessionId, cut, groups],
      )

      const runPreview = async () => {
        if (groups.length === 0) return setStatus(t('needGroup'))
        setBusy(true)
        setStatus(t('previewing'))
        try {
          const value = await api('/preview', { method: 'POST', body: JSON.stringify(payload) })
          const lines = [
            `${t('totalTip')}: ${value.totalTurns} ${t('turnsUnit')}`,
            ...value.groups.map((group, index) => {
              const source = group.source === 'turns' ? t('sourceTurns') : t('sourceRanges')
              return (
                `${index + 1}. ${group.title} · ${group.turns} ${t('turnsUnit')} · ` +
                `${fmt(group.chars)} ${t('charsUnit')} · ${source}: ${runsText(group.ranges)}`
              )
            }),
          ]
          if (value.coverage) {
            const total = value.coverage.totalTurns || 0
            const pct = total > 0 ? Math.round((value.coverage.coveredTurns / total) * 100) : 0
            const duplicated = value.coverage.duplicateTurns > 0
            const complete = value.coverage.ok && value.coverage.complete
            const label = duplicated
              ? t('coverageBad')
              : complete
                ? t('coverageOk')
                : t('coveragePartial')
            lines.push(`${label}: ${value.coverage.coveredTurns}/${total} (${pct}%)`)
            if (value.coverage.duplicateTurns > 0) {
              lines.push(`${t('duplicateTip')}: ${value.coverage.duplicateTurns}`)
            }
          }
          if (value.cut) {
            lines.push(
              `${t('cutKeeps')}: ${value.cut.remainingTurns} ${t('turnsUnit')} / ` +
                `${fmt(value.cut.remainingChars)} ${t('charsUnit')}`,
            )
          }
          setOutput(lines.join('\n'))
          setPreviewed(true)
          setStatus(t('done'))
        } catch (err) {
          setStatus(errorText(t, err))
        } finally {
          setBusy(false)
        }
      }

      const runExport = async () => {
        if (groups.length === 0) return setStatus(t('needGroup'))
        if (cut && !previewed) return setStatus(t('previewFirst'))
        setBusy(true)
        setStatus(t('exporting'))
        try {
          const value = await api('/export', { method: 'POST', body: JSON.stringify(payload) })
          const lines = [`${t('created')}:`]
          for (const id of value.created) lines.push('  ' + id)
          if (value.main) lines.push(`${t('rebuilt')}: ${value.main}`)
          if (value.archived === true) {
            lines.push(t('archivedYes'))
            lines.push(t('cutNext'))
          }
          if (value.archived === false) lines.push(t('archivedNo'))
          setGroups([])
          setSelected([])
          setPreviewed(false)
          await loadSessions()
          // 刷新列表可能触发 resetPlan（原会话已归档而不在列表里），因此提示放在最后写
          setOutput(lines.join('\n'))
          setStatus(t('done'))
        } catch (err) {
          setStatus(errorText(t, err))
        } finally {
          setBusy(false)
        }
      }

      const selectedText = `${t('selectedTip')}: ${selected.length}`

      const dock = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 4px' } },
        h(
          'button',
          {
            ref: chipRef,
            type: 'button',
            title: t('chipTitle'),
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => (open ? close() : openPanel()),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              height: 26,
              padding: '0 10px',
              borderRadius: 13,
              fontSize: 12,
              cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.18))',
              background: open
                ? 'var(--dsw-alias-button-ghost-active-fill, rgba(90,200,255,.16))'
                : 'transparent',
              color: open ? 'var(--dsw-alias-brand-text, #8fd8ff)' : 'var(--dsw-alias-label-primary, inherit)',
            },
          },
          t('chip'),
        ),
      )

      if (!open) return dock

      const panel = h(
        'div',
        {
          ref: panelRef,
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': t('title'),
          tabIndex: -1,
          onKeyDown: (event) => event.stopPropagation(),
          style: panelStyle,
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('div', { style: { flex: 1, fontWeight: 600, fontSize: 14 } }, t('title')),
          h(
            'button',
            {
              type: 'button',
              title: t('close'),
              'aria-label': t('close'),
              onClick: () => close(),
              style: {
                background: 'transparent',
                color: 'var(--dsw-alias-label-tertiary, #9aa0aa)',
                border: 0,
                cursor: 'pointer',
                fontSize: 15,
              },
            },
            '✕',
          ),
        ),
        h(
          'div',
          {
            role: 'status',
            'aria-live': 'polite',
            style: {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              margin: '6px 0',
              padding: '4px 6px',
              borderRadius: 6,
              background: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,.04))',
              color: 'var(--dsw-alias-label-secondary, #cfd6e0)',
              minHeight: 20,
            },
          },
          status,
        ),
        h(
          Section,
          { title: t('s1') },
          h(
            'div',
            { style: rowStyle },
            h(
              'select',
              {
                style: inputStyle,
                value: sessionId,
                disabled: busy,
                'aria-label': t('s1'),
                onChange: (event) => switchSession(event.target.value),
              },
              sessions.length === 0
                ? h('option', { value: '' }, t('none'))
                : sessions.map((row) =>
                    h(
                      'option',
                      { key: row.id, value: row.id, title: row.title || row.id },
                      `${String(row.title || row.id).slice(0, 24)} · ${row.turns} ${t('turnsTip')}`,
                    ),
                  ),
            ),
            h('button', { type: 'button', style: buttonStyle(), disabled: busy, onClick: loadSessions }, t('refresh')),
          ),
        ),
        h(
          Section,
          { title: t('s2') },
          h(
            'div',
            { style: rowStyle },
            h(
              'select',
              {
                style: inputStyle,
                value: mode,
                disabled: busy,
                'aria-label': t('s2'),
                onChange: (event) => setMode(event.target.value),
              },
              h('option', { value: 'auto' }, t('modeAuto')),
              h('option', { value: 'keyword' }, t('modeKeyword')),
              h('option', { value: 'model' }, t('modeModel')),
            ),
            h('button', { type: 'button', style: buttonStyle(), disabled: busy, onClick: loadTopics }, t('loadTopics')),
          ),
        ),
        h(
          Section,
          { title: t('s3') },
          h(
            'div',
            { style: rowStyle },
            h(
              'label',
              { style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                disabled: busy || segments.length === 0,
                checked: segments.length > 0 && selected.length === segments.length,
                onChange: (event) =>
                  setSelected(event.target.checked ? segments.map((_, index) => index) : []),
              }),
              t('selectAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle(),
                disabled: busy || selected.length === 0,
                onClick: () => setSelected([]),
              },
              t('clear'),
            ),
            h('span', { style: mutedStyle }, selectedText),
          ),
          h(
            'div',
            { style: rowStyle },
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle(),
                disabled: busy || selected.length === 0,
                onClick: mergeSelected,
              },
              t('merge'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle(),
                disabled: busy || selected.length === 0,
                onClick: eachSelected,
              },
              t('each'),
            ),
          ),
          h(
            'div',
            { style: listStyle },
            segments.length === 0
              ? h('div', { style: mutedStyle }, t('segmentsEmpty'))
              : segments.map((segment, index) =>
                  h(
                    'label',
                    {
                      key: `${segment.from}-${segment.to}-${index}`,
                      style: { display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', cursor: 'pointer' },
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: selected.includes(index),
                      disabled: busy,
                      onChange: () => toggleSegment(index),
                    }),
                    h('span', { style: { flex: 1 } }, `${segment.label}  ${segment.from}-${segment.to}`),
                    h('span', { style: mutedStyle }, `${fmt(segment.chars)} ${t('charsTip')}`),
                  ),
                ),
          ),
        ),
        h(
          Section,
          { title: t('s4') },
          h(
            'div',
            { style: rowStyle },
            h(
              'select',
              {
                style: { ...inputStyle, flex: '0 0 auto', maxWidth: 180 },
                value: addMode,
                disabled: busy,
                'aria-label': t('s4'),
                onChange: (event) => setAddMode(event.target.value),
              },
              h('option', { value: 'ranges' }, t('modeRanges')),
              h('option', { value: 'turns' }, t('modeTurns')),
            ),
            h('input', {
              style: inputStyle,
              value: spec,
              disabled: busy,
              placeholder: addMode === 'ranges' ? t('hintRanges') : t('hintTurns'),
              'aria-label': addMode === 'ranges' ? t('modeRanges') : t('modeTurns'),
              onChange: (event) => setSpec(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addManual()
              },
            }),
            h('button', { type: 'button', style: buttonStyle(), disabled: busy, onClick: addManual }, t('addGroup')),
          ),
        ),
        h(
          Section,
          { title: `${t('s5')} · ${groups.length}` },
          h(
            'div',
            { style: listStyle },
            groups.length === 0
              ? h('div', { style: mutedStyle }, t('groupsEmpty'))
              : groups.map((group, index) =>
                  h(
                    'div',
                    { key: `${group.title}-${index}`, style: rowStyle },
                    h(
                      'span',
                      {
                        style: {
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        },
                        title: `${group.title} · ${group.spec}`,
                      },
                      `${index + 1}. ${group.title} · ${group.spec}`,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        style: buttonStyle(false, true),
                        disabled: busy,
                        onClick: () => removeGroup(index),
                      },
                      t('remove'),
                    ),
                  ),
                ),
          ),
        ),
        h(
          Section,
          { title: t('s6') },
          h(
            'label',
            { style: { display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 4 } },
            h('input', {
              type: 'checkbox',
              checked: cut,
              disabled: busy,
              onChange: (event) => {
                setCut(event.target.checked)
                setPreviewed(false)
              },
            }),
            h(
              'span',
              null,
              h('div', null, t('cut')),
              h('div', { style: { ...mutedStyle, fontSize: 11 } }, t('cutHint')),
            ),
          ),
          h(
            'div',
            { style: rowStyle },
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle(true),
                disabled: busy || groups.length === 0,
                onClick: runPreview,
              },
              t('preview'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: buttonStyle(true, cut),
                disabled: busy || groups.length === 0 || (cut && !previewed),
                title: cut && !previewed ? t('previewFirst') : t('export'),
                onClick: runExport,
              },
              cut && !previewed ? t('previewFirst') : cut ? t('exportCut') : t('export'),
            ),
          ),
          output ? h('pre', { style: outputStyle }, output) : null,
        ),
      )

      return h(React.Fragment, null, dock, createPortal(panel, document.body))
    }
  }

  // ---------------------------------------------------------------- 装载

  try {
    const loader = window.__ModuleLoader__
    if (!loader || typeof loader.load !== 'function') {
      console.warn(TAG, 'module loader missing; client skipped')
      return
    }
    loader.load({
      id: 'dsh-topic-split',
      factory(require) {
        try {
          const React = require('react')
          const { createPortal } = require('react-dom')
          let translate = (key) => key
          const Dock = createDock(React, createPortal, () => translate)
          return {
            inject: ['slots', 'locale'],
            apply(ctx) {
              try {
                ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-topic-split: locale')
                translate = ctx.locale.bind(NS)
                ctx.slots.inject(SLOT, () =>
                  ctx.slots.register(
                    {
                      name: SLOT,
                      id: 'dsh-topic-split',
                      order: 21,
                      inject: (sessionId) => (sessionId === undefined ? {} : { sessionId }),
                    },
                    Dock,
                  ),
                )
              } catch (err) {
                console.warn(TAG, 'apply failed (ignored):', err && err.message ? err.message : err)
              }
            },
          }
        } catch (err) {
          console.warn(TAG, 'factory failed (inert):', err && err.message ? err.message : err)
          return { inject: [], apply() {} }
        }
      },
    })
  } catch (err) {
    console.warn(TAG, 'load failed (ignored):', err && err.message ? err.message : err)
  }
})()
