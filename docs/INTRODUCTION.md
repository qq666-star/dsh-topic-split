# dsh-topic-split — 详细介绍 / Detailed Guide

> 版本 `0.12.2` · 许可证 GPL-3.0-only · npm: https://www.npmjs.com/package/dsh-topic-split
>
> 中文在前，English follows. 本文是面向用户与开发者的完整说明；README 是快速上手版。

---

## 目录 / Contents

**中文**

1. [一句话定位](#1-一句话定位)
2. [它解决什么问题](#2-它解决什么问题)
3. [适用与不适用](#3-适用与不适用)
4. [核心概念](#4-核心概念)
5. [功能全览](#5-功能全览)
6. [安装与快速开始](#6-安装与快速开始)
7. [四个使用场景](#7-四个使用场景)
8. [工具参考](#8-工具参考)
9. [面板操作指南](#9-面板操作指南)
10. [工作原理](#10-工作原理)
11. [安全模型](#11-安全模型)
12. [配置与环境变量](#12-配置与环境变量)
13. [兼容性与已知限制](#13-兼容性与已知限制)
14. [故障排查与错误码](#14-故障排查与错误码)
15. [开发、测试与发布](#15-开发测试与发布)
16. [项目信息](#16-项目信息)

**English**

1. [What it is](#english-1-what-it-is)
2. [The problem](#english-2-the-problem)
3. [When to use it](#english-3-when-to-use-it)
4. [Core concepts](#english-4-core-concepts)
5. [Capabilities](#english-5-capabilities)
6. [Install and quick start](#english-6-install-and-quick-start)
7. [Scenarios](#english-7-scenarios)
8. [Tool reference](#english-8-tool-reference)
9. [Panel guide](#english-9-panel-guide)
10. [How it works](#english-10-how-it-works)
11. [Security model](#english-11-security-model)
12. [Configuration](#english-12-configuration)
13. [Compatibility and limits](#english-13-compatibility-and-limits)
14. [Troubleshooting](#english-14-troubleshooting)
15. [Development and release](#english-15-development-and-release)

---

# 中文

## 1. 一句话定位

**dsh-topic-split 把一段长对话里你选中的内容，变成一个可以继续对话的独立会话。**

它有三种典型用法：

- **按主题拆**：自动判断主题边界，把长会话分成几个专题会话；
- **按轮次挑**：精确挑选散落在各处的若干轮，导出一个精确的会话；
- **剪除归档**：把挑走的部分从原会话移除，用剩余内容重建主会话。

它**不是分屏插件**，也不只是“导出 Markdown”——导出的结果是 DSH 能重新打开、继续追问、正常回复的合法会话。

---

## 2. 它解决什么问题

### 2.1 长会话已经不方便使用

一个跨天的项目会话很容易到 200+ 轮、8 MB 以上。翻找历史、复制上下文、让模型继续某个子话题，都变得低效。

### 2.2 主题是交错的

真实对话不是按主题整齐分段的。以一条 226 轮的真实会话为例：

| 主题 | 命中轮次 | 分成几段 | 最大间隔 |
|---|---:|---:|---:|
| 桌宠/形象/语音 | 81 | 30 | 23 轮 |
| 会话管理/插件 | 78 | 14 | 76 轮 |
| 参赛方案 | 34 | 14 | 81 轮 |
| 密钥/隐私 | 31 | 17 | 41 轮 |
| 系统维护 | 28 | 20 | 30 轮 |

**同时命中 2 组以上关键词的轮次占 34%。**

这意味着：只用“连续区间”切，必然出现两种错误——

- 同主题的散点没被带出去；
- 中间的无关轮次被一起带出去。

### 2.3 现有替代方案都不完整

| 方案 | 能做到 | 做不到 |
|---|---|---|
| 手动复制粘贴 | 选内容 | 慢、易漏、没有会话结构 |
| 导出 Markdown | 保存文本 | 不能继续对话 |
| 官方 fork | 从某轮开始保留前缀 | 切不出中间段、不能跳着选 |
| 分屏插件 | 同时看多个会话 | 不改变内容归属 |
| **本插件** | 任意轮次、覆盖率校验、导出可继续、可剪除归档 | 工具调用记录不保留（见限制） |

---

## 3. 适用与不适用

### 适合

- 单个会话超过 100 轮，或超过 2 MB；
- 需要按主题整理历史，方便以后检索；
- 想把某段讨论交给另一个会话/同事继续；
- 想清理主会话，但不想丢内容；
- 需要把“散点”内容精确提取出来（`turns`）。

### 不适合

- 只想把两个会话并排看（用分屏插件）；
- 想保留完整工具调用链（本插件只导出文字）；
- 想双向同步（导出是快照）；
- 会话很短（不到 20 轮），手动整理更快。

---

## 4. 核心概念

### 轮次（turn）

DSH 会话由一轮一轮的“用户提问 + 助手回复”组成。插件里所有下标都是 **0 基**：第一轮是 `0`。

### 区间（ranges）

连续的一段，例如：

- `0-51`：第 0 到 51 轮；
- `52-87,90-96`：两段；
- `78-end`：从 78 到最后一轮。

### 轮次集合（turns）

任意轮次的集合，例如：

- `3`：只选第 3 轮；
- `3,7-9,20`：第 3、7、8、9、20 轮。

适合“同一主题散落在很多位置”的情况。

### 选中 + 排除 = 全部

这是插件的核心不变量。每次预览/核对都会同时给出：

- 选中了多少轮、多少字；
- 排除了多少轮、多少字；
- 两者相加是否等于源会话。

### 快照

导出的会话是**快照**：可以继续对话，但原会话后续的变化不会同步过去。

### 剪除（cut）

把选中的轮次从原会话“拿走”：

1. 导出选中轮次为新会话；
2. 用剩余轮次新建一个主会话（只保留文字）；
3. 把原会话登记为归档（文件保留，目录不改名）。

---

## 5. 功能全览

### 5.1 Agent 工具

| 工具 | 作用 |
|---|---|
| `session_topics` | 自动分主题，输出区间、字数、覆盖率 |
| `session_export` | 导出选中轮次为独立会话 |
| `session_cut` | 剪除选中轮次并重建会话 |
| `session_coverage` | 核对“选中 + 排除 = 全部” |
| `session_diag` | 自检与排障 |

### 5.2 可视化面板

注册在 `conversation.input.dock`（输入框上方），点击「拆分 / Split」打开，6 步完成：

选会话 → 分段 → 勾选 → 手动补充 → 分组 → 预览/导出。

### 5.3 HTTP 接口（面板使用）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-topic-split/sessions` | 会话列表（最多 50 条） |
| GET | `/dsh-topic-split/topics?sessionId=&mode=` | 主题分段 |
| POST | `/dsh-topic-split/preview` | 预览导出计划 |
| POST | `/dsh-topic-split/export` | 执行导出（可 dryRun/cut） |
| GET | `/dsh-topic-split/diag` | 脱敏诊断 |

默认启用，但强制令牌；只允许本机来源；带限流。

---

## 6. 安装与快速开始

### 安装

在 DSH 中打开 **Plugins → Add plugin**，选择 `dsh-topic-split`（或本地目录）。

> 不要手工改 profile 的 `package.json`。官方安装会处理依赖、bundle 选择、兼容性检查和 build 审批。

### 快速验证

1. 重启 `dsh web`；
2. 看输入框上方是否出现「拆分 / Split」；
3. 新会话里让 agent 调用 `session_diag`；
4. 打开面板，选当前会话 → 获取分段 → 预览（不写盘）。

### 最小示例

```text
session_topics(sessionId="<id>", mode="auto")
```

```text
session_export(sessionId="<id>", turns="3,7-9,20", dryRun=true)
```

```text
session_export(sessionId="<id>", turns="3,7-9,20")
```

---

## 7. 四个使用场景

### 场景 A：把长会话按主题归档

1. 打开面板，选择源会话；
2. 获取分段（建议 `auto`）；
3. 勾选若干段，点「按段合并为一组」或「每段各成一组」；
4. 预览，确认覆盖率；
5. 导出。

结果：得到几个专题会话，每个都能继续聊。

### 场景 B：精确提取散落的同主题内容

1. 先用 `session_topics` 看主题分布；
2. 用关键词或人工判断找出散点轮次；
3. 用 `turns` 传入，如 `"0,2-3,10,33-36,78"`；
4. `dryRun=true` 先看“选中/排除/连续块数”；
5. 确认后导出。

注意：散点导出会缺少中间上下文，插件会在预览里明确提示。

### 场景 C：清理会话但保留内容

使用 `cut: true` 或 `session_cut`：

```text
session_export(sessionId="<id>", turns="40-60", cut=true)
```

结果：

- 40–60 轮进入新会话；
- 剩余轮次重建为新主会话；
- 原会话归档（仍可取消归档）；
- 当前页面仍显示归档的原会话，需要到侧栏打开新主会话。

### 场景 D：把一段讨论交给别人继续

1. 导出目标轮次为独立会话；
2. 把会话 id 或导出后的 Markdown 交给对方；
3. 对方在自己的 DSH 中打开后可以直接继续提问。

---

## 8. 工具参考

### 8.1 `session_topics`

| 参数 | 必填 | 说明 |
|---|---|---|
| `sessionId` | 是 | 会话 id 或前缀 |
| `mode` | 否 | `auto`（默认）/ `model` / `keyword` |

输出：主题清单、每段轮次区间与字数、覆盖率校验、实际使用的模式。

`auto`：优先判断模型，失败自动回退关键词，并在输出中标注失败原因。

### 8.2 `session_export`

| 参数 | 必填 | 说明 |
|---|---|---|
| `sessionId` | 是 | 源会话 |
| `ranges` | 二选一 | 连续区间，如 `0-51,52-87`、`78-end` |
| `turns` | 二选一 | 任意轮次，如 `3,7-9,20` |
| `dryRun` | 否 | `true` 只预览，不写盘 |
| `cut` | 否 | `true` 导出后剪除并归档原会话 |
| `title` | 否 | 预留字段；当前版本不写入标题事件，标题由 DSH 自动生成 |

行为：

- 不给 `ranges/turns` 且 `dryRun=true`：按主题分段给出逐段计划；
- 给 `ranges/turns` 且 `dryRun=true`：给出选中/排除/连续块/剪除后果；
- 不给 `dryRun`：直接写入（`cut: true` 时还会重建主会话并归档）。

### 8.3 `session_cut`

| 参数 | 必填 | 说明 |
|---|---|---|
| `sessionId` | 是 | 源会话 |
| `ranges` / `turns` | 二选一 | 要剪掉的轮次 |
| `dryRun` | 否 | 默认 `true`，只预览 |
| `archive` | 否 | `true` 归档原会话 |
| `title` | 否 | 预留字段 |

注意：重建的会话只保留文字，工具调用记录不会带入。

### 8.4 `session_coverage`

| 参数 | 必填 | 说明 |
|---|---|---|
| `sessionId` | 是 | 会话 |
| `ranges` / `turns` | 二选一 | 要核对的选择 |

输出：

```text
源会话 226 轮 / 323,190 字
选中 31 轮 / 49,768 字（17 个连续块）
排除 195 轮 / 273,422 字
合计 226 轮 / 323,190 字 → 一致 ✔
```

### 8.5 `session_diag`

无参数。输出：Node/DSH 环境、DSH_HOME、会话目录、注册表、工具清单、配置摘要、
缓存命中、判断模型状态、急停开关、归档目录残留。

### 8.6 错误码

| 错误码 | 含义 |
|---|---|
| `SESSION_NOT_FOUND` | 找不到会话 |
| `SESSION_ID_INVALID` | 会话 id 非法（含路径穿越） |
| `FILE_TOO_LARGE` | 会话文件超过上限 |
| `FILE_CORRUPT` | 会话文件损坏 |
| `RANGE_INVALID` | 区间格式/越界/缺失 |
| `RANGE_TOO_MANY` | 区间或轮次项过多 |
| `TURNS_INVALID` | 轮次格式错误、越界、与 ranges 冲突 |
| `EMPTY_RESULT` | 结果为空（如剪掉全部） |
| `CONFIG_INVALID` | 配置非法 |
| `PATH_OUTSIDE_ROOT` | 目标路径越界 |
| `IO_FAILED` | 读写失败 |
| `JUDGE_UNAVAILABLE` | 判断模型不可用 |
| `JUDGE_TIMEOUT` | 判断模型超时 |
| `JUDGE_BAD_OUTPUT` | 判断模型输出校验失败 |
| `ABORTED` | 调用被取消 |

---

## 9. 面板操作指南

### 步骤 1：选择会话

下拉列表显示标题（或 id）与轮数；可刷新。默认当前会话。

**切换会话会清空已加载的分段、勾选、分组和预览结果**，防止把旧会话的区间套到新会话上。

### 步骤 2：分段方式

- `自动（模型优先）`：先模型，失败回退关键词；
- `关键词规则`：不调用模型，速度快；
- `强制模型`：失败直接报错，不静默回退。

### 步骤 3：选择内容

- 全选 / 清空；
- 「按段合并为一组」：把勾选的段合成一个导出组；
- 「每段各成一组」：每段一个导出组。

### 步骤 4：手动添加

一个输入框 + 模式选择：

- **连续区间**：`0-51,52-96`
- **精确轮次**：`3,7-9,20`

### 步骤 5：导出分组

显示每组标题与规格（`ranges:` 或 `turns:`），可删除。

### 步骤 6：预览与导出

- 勾选「导出后从原会话剪除并归档」后，**必须先预览**，导出按钮才会启用；
- 预览显示每组轮次/字数、覆盖率、重叠轮数、剪除后主会话保留量；
- 导出后提示新会话 id、主会话 id、是否归档，并提示“当前页面仍属于已归档原会话”。

### 交互细节

- 请求进行中禁用按钮，防止双击重复创建；
- Esc 关闭面板，焦点回到入口；
- 点击面板外部关闭（不抢焦点）；
- 状态条 `role="status" aria-live="polite"`；
- 错误按错误码显示中英提示。

---

## 10. 工作原理

### 10.1 会话是 append-only 事件流

DSH 的会话文件是 `session.v4.jsonl.zstd`，由一串事件组成：

```text
permission/preset → sandbox/mode → approval/policy → session/end-seed
每轮：
  agent/inbox/spliced(insert) → turn/start → agent/inbox/spliced(remove)
  → step/start → [首轮] system/message → user/message → assistant/message
  → step/end → turn/end
```

要求：

- `seq` 从 0 连续递增；
- `turn` 从 1 开始；
- 首轮必须有受保护的 `system/message`；
- 每轮有配对的注入/移除事件。

缺任何一条，GUI 追加消息时都会判定结构损坏。

### 10.2 多帧 zstd

DSH 的日志是多帧 zstd。Node 的 `zstdDecompressSync` 只解第一帧，所以插件：

1. 扫描帧魔数，找到每一帧的边界；
2. 逐帧解压；
3. 拼接 JSONL；
4. 尾帧截断时保留已解出的部分。

### 10.3 目录键

导出的会话必须落在 DSH 认识的目录。`projectKey` 的规则逐条实现：

- 分隔符 `/` `\` `:` 折叠为 `-`；
- 不安全码元转 `~XXXX`；
- 截断到 251 字符；
- 空路径回退 `root`。

### 10.4 登记与归档

- 新建：优先 `workspaceRegistry.attachSession(id)`；
- 归档：`workspaceRegistry.archiveSession(id)`，只记 id，不改目录；
- 文件写入只作兜底：备份 → 读-改-写 → 回读校验 → 失败回滚。

**绝不把会话目录改名**：DSH 会用头里的 id + cwd 推导路径，目录一改名，整份会话列表读取失败。

### 10.5 客户端

- 注册在 `conversation.input.dock` 的 React 组件；
- 文案 `ctx.locale`；颜色 `--dsw-alias-*`；
- 固定浮层 `createPortal`；
- 不读写宿主 DOM，不 append 到 `document.body`；
- loader / factory / apply 三层兜底，失败降级为 inert，不拖垮 `web boot`。

### 10.6 缓存与上限

- 解析结果按 mtime 缓存（默认 8 条）；
- 压缩态上限 80 MB，解压后上限 300 MB；
- 工具超时 60 秒，支持 AbortSignal。

---

## 11. 安全模型

| 威胁 | 防护 |
|---|---|
| 本机其他程序读会话 | 面板接口需令牌；令牌进程内随机，只注入受鉴权页面 |
| 恶意网页 DNS rebinding | 校验 Host、连接来源、Origin、Sec-Fetch-Site |
| 刷接口 | 普通 60 次/分，导出 6 次/分 |
| 路径穿越 | 会话 id 白名单；写入必须落在 DSH_HOME 内 |
| 写坏数据 | 原子写；登记失败回滚；归档不改目录 |
| 插件拖垮 Web | 客户端三层兜底；宿主注册失败只告警 |
| 遥测/外传 | 无 |
| 判断模型泄露全文 | 只发送每轮摘要（用户首句 + 助手首句） |

**边界**：插件运行在宿主进程内，拥有与宿主相同的文件权限；同权限的恶意程序本来就能直接读 `~/.dsh`，插件不是额外瓶颈。

---

## 12. 配置与环境变量

### 宿主配置（`apply(ctx, config)`）

| 键 | 默认 | 说明 |
|---|---|---|
| `maxCompressedBytes` | 80 MB | 压缩态上限 |
| `maxInflatedBytes` | 300 MB | 解压后上限 |
| `cacheEntries` | 8 | 解析缓存条数 |
| `minSegmentTurns` / `minSegmentChars` | 3 / 4000 | 短段平滑阈值 |
| `maxRanges` | 50 | 单次区间/轮次项上限 |
| `httpRoutes` | `token` | `token` / `off` |
| `httpToken` | 空 | 留空则进程内随机 |
| `httpRateLimitPerMin` | 60 | 普通请求限流 |
| `httpExportPerMin` | 6 | 导出请求限流 |
| `exposeTitles` | `true` | 面板是否返回标题 |
| `semantic.backend` | `auto` | `auto` / `kernel` / `http` / `off` |
| `semantic.provider` / `model` | `deepseek-official` / `deepseek-flash` | 内核路由 |
| `semantic.timeoutMs` | 25000 | 单次判断超时 |
| `semantic.retries` | 1 | 校验失败重试 |
| `semantic.summaryChars` | 120 | 每轮摘要字数 |
| `semantic.httpBaseUrl` / `httpModel` | 空 | OpenAI 兼容端点 |
| `semantic.httpKeyEnv` | `DSH_SESSION_SPLIT_JUDGE_KEY` | 密钥环境变量名 |
| `topics` | 内置 7 组 | 关键词回退规则 |

### 环境变量

```powershell
$env:DSH_SESSION_SPLIT_DISABLE = '1'        # 宿主侧完全不注册
$env:DSH_SESSION_SPLIT_DEBUG = '1'          # 调试日志
$env:DSH_SESSION_SPLIT_HTTP = 'off'         # 关闭面板接口
$env:DSH_SESSION_SPLIT_JUDGE = 'off'        # 关闭判断模型
$env:DSH_SESSION_SPLIT_JUDGE = 'kernel'     # 强制内核模型
$env:DSH_SESSION_SPLIT_JUDGE_MODEL = '...'  # 覆盖模型
$env:DSH_SESSION_SPLIT_JUDGE_URL = 'https://api.deepseek.com/v1'
$env:DSH_SESSION_SPLIT_JUDGE_HTTP_MODEL = 'deepseek-chat'
$env:DSH_SESSION_SPLIT_JUDGE_KEY = '<key>'
```

---

## 13. 兼容性与已知限制

| 项 | 状态 |
|---|---|
| Node | ≥ 22 |
| DSH | `>=0.2.2-rc.5 <0.3.0` |
| 平台 | Windows 已实测；Linux/macOS 逻辑兼容但未真机验证 |
| 许可证 | GPL-3.0-only |

### 限制

1. **只导出文字**：工具调用、命令输出、文件改动不会带入。
2. **快照不同步**：导出后的新消息不会回写源会话。
3. **散点缺上下文**：`turns` 不连续时，导出会话缺少中间轮次；预览会提示。
4. **一轮是原子单位**：同一轮前后半段不同主题时只能整轮归类。
5. **主题判断可能出错**：模型只看摘要；关键词规则较粗。建议先 `dryRun`。
6. **UI 视觉未验收**：当前开发环境无浏览器；逻辑、注册契约、宿主行为有测试，但
   面板的实际渲染、主题明暗、窄屏适配尚未完成真实浏览器验收。
7. **Linux/macOS 未真机验证**。

---

## 14. 故障排查与错误码

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 面板返回 401 | 令牌随进程重启轮换 | 刷新页面 |
| 面板返回 404 | `httpRoutes=off` | 设 `DSH_SESSION_SPLIT_HTTP=token` 后重启 |
| 面板返回 403 | 非本机 Host/来源 | 只从本机访问，勿走反代 |
| 429 | 触发限流 | 等待一分钟后重试 |
| 会话列表整块消失 | 目录里有 `.archived-*` 残留 | 0.9.2+ 启动会自动改回；也可手动改回 `session-<id>` |
| 导出会话打不开/corrupt | 结构不完整 | 用 `session_diag` 检查；升级到 0.12.2 |
| 主题分段失败 | 判断模型不可用 | 已自动回退关键词；或设 `mode=keyword` |
| 剪除后主会话不见了 | 原会话已归档，主会话是新建的 | 到侧栏找新主会话 |

---

## 15. 开发、测试与发布

### 目录结构

```text
src/            宿主侧：配置、存储、分段、判断模型、导出、工具、HTTP
client/         浏览器侧：slot React 组件、面板、主题 token
locale/         Plugin Manager 的标题与描述（zh/en）
scripts/        规范检查、测试汇总、manifest 校验、沙盒、开发安装脚本
test/           node:test 用例（114 个）
docs/           本文档
```

### 命令

```powershell
npm test            # 116 个用例
npm run lint        # 9 条代码规范
npm run validate    # manifest / locale / icon 静态校验
npm run check       # lint + validate + test
node scripts/sandbox-turns.mjs   # 临时 DSH_HOME 沙盒
```

### 验证边界

- 已验证：语法、manifest、116 个测试、HTTP 行为、会话结构、源会话只读、客户端注册契约；
- 未验证：真实浏览器渲染、主题明暗、390px 窄屏、live slot、Plugin Manager 图标显示、
  Linux/macOS 真机。

### 发布注意

npm 对首次发布会启用**暂存发布**：先出现 `0.0.0-stage` 占位，真实版本进入 staged release，
约 1–2 分钟后自动放行。不要手动删除占位版本。

---

## 16. 项目信息

| 项 | 值 |
|---|---|
| npm | https://www.npmjs.com/package/dsh-topic-split |
| 版本 | `0.12.2` |
| 许可证 | GPL-3.0-only |
| 仓库 | https://github.com/qq666-star/dsh-topic-split |
| 测试 | 116 个用例（单元、集成、HTTP 鉴权、性能、客户端注册契约） |
| 兼容 | Node ≥ 22；DSH `>=0.2.2-rc.5 <0.3.0` |

---

# English

## English 1. What it is

**dsh-topic-split** turns selected content from a long conversation into a new,
independently resumable DSH session. You can split by topic, pick arbitrary turns,
or remove selected turns and rebuild the main session.

It is not a split-screen viewer, and its output is not a Markdown export: the
result is a valid DSH session that can be reopened, continued, and answered.

## English 2. The problem

Long project conversations reach hundreds of turns and several megabytes. Topics
are interleaved: in a 226-turn sample, one topic appeared in 30 separate runs with
a maximum gap of 23 turns, and 34% of turns matched two or more topic groups. A
contiguous-range split therefore either misses scattered content or drags
unrelated turns along.

Existing options are incomplete:

| Option | Limitation |
|---|---|
| Manual copy/paste | Slow, error-prone, no session structure |
| Markdown export | Dead text; cannot continue the conversation |
| Official fork | Prefix-only; cannot cut a middle segment or pick scattered turns |
| Split-screen plugins | Changes the view, not content ownership |
| **This plugin** | Arbitrary turns, coverage checks, resumable export, optional cut/archive |

## English 3. When to use it

Use it when:

- a session exceeds ~100 turns or ~2 MB;
- you want topic-based archives;
- you want to hand a discussion to another session or teammate;
- you want to clean up a session without losing content;
- you need to extract scattered turns precisely.

Do not use it for split-screen viewing, preserving full tool-call history,
two-way synchronization, or very short conversations.

## English 4. Core concepts

- **Turn**: one user question plus the assistant reply. Indices are 0-based.
- **Ranges**: contiguous spans such as `0-51`, `52-87`, or `78-end`.
- **Turns**: arbitrary turn sets such as `3,7-9,20`.
- **Selected + excluded = whole**: the plugin verifies both turn count and
  character count.
- **Snapshot**: an exported session can be continued, but later changes in the
  source are not synchronized.
- **Cut**: export the selection, rebuild the main session from the remaining
  turns, and archive the source.

## English 5. Capabilities

| Capability | Description |
|---|---|
| Topic segmentation | `auto` uses the judge model, falling back to keyword rules |
| Arbitrary turns | `turns: "3,7-9,20"` |
| Contiguous ranges | `ranges: "0-51,52-87"` |
| Coverage check | Selected + excluded equals the whole conversation |
| Resumable export | Produces a valid DSH session that can continue |
| Cut and archive | Rebuild the main session, archive the source without renaming dirs |
| Visual panel | Six-step panel above the composer |
| Diagnostics | Paths, config, cache, judge model, switches |

Five tools are provided: `session_topics`, `session_export`, `session_cut`,
`session_coverage`, and `session_diag`.

## English 6. Install and quick start

Install through **Plugins → Add plugin** and choose `dsh-topic-split`, then restart
`dsh web`. A **Split** control appears above the composer.

Quick verification:

1. Confirm the control is visible.
2. Call `session_diag` in a new session.
3. Open the panel, load segments, and preview without writing.

Minimal examples:

```text
session_topics(sessionId="<id>", mode="auto")
session_export(sessionId="<id>", turns="3,7-9,20", dryRun=true)
session_export(sessionId="<id>", turns="3,7-9,20")
```

## English 7. Scenarios

**A. Topic archives.** Load segments, select several, merge or split them into
groups, preview coverage, and export.

**B. Scattered extraction.** Use `session_topics` to inspect the distribution, then
pass exact turns and preview with `dryRun: true`. The preview warns that scattered
turns lack intermediate context.

**C. Clean up while keeping content.** Use `cut: true` or `session_cut`: the
selection is exported, the remaining turns become a new main session, and the
source is archived. Open the new main session from the sidebar.

**D. Hand-off.** Export a target range as a session and let the recipient continue
it in their own DSH.

## English 8. Tool reference

| Tool | Key parameters | Notes |
|---|---|---|
| `session_topics` | `sessionId`, `mode` | `auto`, `model`, or `keyword` |
| `session_export` | `sessionId`, `ranges`/`turns`, `dryRun`, `cut` | `title` is reserved; the title is generated by DSH |
| `session_cut` | `sessionId`, `ranges`/`turns`, `dryRun`, `archive` | Previews by default |
| `session_coverage` | `sessionId`, `ranges`/`turns` | Reports selected, excluded, and totals |
| `session_diag` | none | Self-check |

Error codes include `SESSION_NOT_FOUND`, `SESSION_ID_INVALID`, `FILE_TOO_LARGE`,
`FILE_CORRUPT`, `RANGE_INVALID`, `RANGE_TOO_MANY`, `TURNS_INVALID`,
`EMPTY_RESULT`, `CONFIG_INVALID`, `PATH_OUTSIDE_ROOT`, `IO_FAILED`,
`JUDGE_UNAVAILABLE`, `JUDGE_TIMEOUT`, `JUDGE_BAD_OUTPUT`, and `ABORTED`.

## English 9. Panel guide

1. **Session**: choose the source; switching resets loaded segments and groups.
2. **Segmentation**: auto, keyword, or forced model.
3. **Selection**: select all, clear, merge selected segments, or split each.
4. **Manual add**: one input with a mode switch for ranges or exact turns.
5. **Groups**: review and remove output groups.
6. **Preview/export**: with cut enabled, preview is mandatory; the preview shows
   per-group turns/chars, coverage, duplicates, and how many turns the main session
   will keep.

Requests disable controls while running; Escape closes the panel and returns focus
to the entry; status uses `role="status" aria-live="polite"`.

## English 10. How it works

- Session logs are append-only event streams. Exported sessions reproduce the real
  head events, per-turn inbox splices, the first `system/message`, and a continuous
  `seq` sequence starting at 0 with turns starting at 1.
- DSH logs are multi-frame zstd. The plugin scans frame boundaries, decompresses
  each frame, and tolerates a truncated tail frame.
- Project directory keys follow DSH's `projectKey` rules (`~XXXX` escaping, 251-char
  truncation, `root` fallback).
- New sessions are registered through `workspaceRegistry`; archiving records the id
  without renaming directories. File writes are a fallback with backup, read-back
  verification, and rollback.
- The client is a React component registered in `conversation.input.dock`, uses
  `ctx.locale`, theme tokens, and `createPortal` for the fixed overlay.

## English 11. Security model

| Threat | Mitigation |
|---|---|
| Local process reading sessions | Token-protected routes; per-process random token injected only into authenticated pages |
| DNS rebinding / CSRF | Host, peer address, Origin, and Sec-Fetch-Site checks |
| Abuse | 60 requests/min general, 6 exports/min |
| Path traversal | Session id allowlist; writes restricted to DSH_HOME |
| Data corruption | Atomic writes, rollback, no directory renaming |
| Plugin breaking Web boot | Three-layer client fallback; host registration failures degrade |
| Telemetry | None |
| Judge model exposure | Only per-turn summaries are sent |

The plugin runs in the host process with host-level file permissions; it is not a
sandbox boundary against same-user processes.

## English 12. Configuration

Host config includes size limits (80 MB compressed / 300 MB inflated), 8 cache
entries, segment smoothing (3 turns / 4000 chars), 50 range items, `httpRoutes`
(`token`/`off`), rate limits, `exposeTitles`, and `semantic.*` settings for the
judge model. Environment variables use the `DSH_SESSION_SPLIT_*` prefix, including
`DISABLE`, `DEBUG`, `HTTP`, `JUDGE`, `JUDGE_MODEL`, `JUDGE_URL`, and
`JUDGE_KEY`.

## English 13. Compatibility and limits

- Node ≥ 22; DSH `>=0.2.2-rc.5 <0.3.0`; GPL-3.0-only.
- Windows tested; Linux/macOS path logic is aligned but not tested on real machines.
- Exported sessions contain text only; tool calls are not included.
- Exports are snapshots and do not sync back.
- Scattered turns lose intermediate context.
- A turn is atomic.
- Topic detection may be wrong; preview first.
- The panel's visual rendering has not been verified in a real browser in the
  current development environment.

## English 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 401 | Token rotated after restart | Refresh the page |
| 404 | `httpRoutes=off` | Set `DSH_SESSION_SPLIT_HTTP=token` and restart |
| 403 | Non-local Host/Origin | Access from localhost only |
| 429 | Rate limited | Wait a minute |
| Session list disappears | `.archived-*` directories | 0.9.2+ repairs them on startup |
| Corrupt export | Invalid session structure | Run `session_diag`; upgrade to 0.12.2 |

## English 15. Development and release

```powershell
npm test            # 116 tests
npm run lint        # 9 style rules
npm run validate    # manifest / locale / icon checks
npm run check       # lint + validate + test
```

The npm first publish uses staged publishing: a `0.0.0-stage` placeholder appears
first, the real version is released after a short review window, and `latest`
points to the real version. Do not delete the placeholder manually.

---

## 术语表 / Glossary

| 中文 | English | 说明 |
|---|---|---|
| 轮次 | turn | 一轮用户提问 + 助手回复，0 基 |
| 区间 | ranges | 连续轮次，如 `0-51` |
| 轮次集合 | turns | 任意轮次，如 `3,7-9` |
| 覆盖率 | coverage | 选中 + 排除 = 全部 |
| 剪除 | cut | 导出后移除并重建主会话 |
| 快照 | snapshot | 可继续但不回写源会话 |
| 判断模型 | judge model | 用于主题边界的模型 |
| 插槽 | slot | DSH 客户端 UI 的渲染位置 |
