# dsh-topic-split

从长会话中按主题或任意轮次挑选内容，导出为可继续的独立会话；支持覆盖率核对、导出后剪除并归档。控件在输入框上方，不是分屏插件。

## 能力

| 位置 | 名称 | 说明 |
|---|---|---|
| Host | `session_topics` | 自动分主题（`mode=auto/model/keyword`），输出轮次区间 + 字数 + 覆盖率校验 |
| Host | `session_export` | 按轮次导出成「一问一答」结构的独立会话；`ranges` 连续区间（`0-51,52-87`）或 `turns` 任意轮次集合（`3,7-9,20`）；`dryRun=true` 只预览不写盘；`cut=true` 导出后把选中轮次从源会话剪掉 |
| Host | `session_coverage` | 核对「选中 + 排除」是否等于原会话总量（轮次与字数双维度） |
| Host | `session_diag` | 自检：路径、配置、缓存、判断模型与开关状态 |
| Host | `session_cut` | 把选中轮次从会话中剪掉：用剩余轮次重建新会话；`ranges` 或 `turns`；默认预览，`archive=true` 归档原会话 |
| Client | 「拆分 / Split」控件 | 注册在 `conversation.input.dock`（输入框上方）；React 组件 + `ctx.locale` + 主题 token；点击打开六步面板：选会话 → 分段 → 勾选 → 手输区间/轮次 → 分组 → 预览/导出（可剪除） |
| HTTP | `/dsh-topic-split/*` | 面板接口：默认启用，需令牌、仅限本机、带限流；`httpRoutes: 'off'` 可完全关闭 |

## 安装

在 DSH 中打开 **Plugins → Add plugin**，选择包名 `dsh-topic-split`（或本地目录）。
官方安装路径会完成依赖、bundle 选择、兼容性检查与 build 审批，**不要手工改 profile 的 `package.json`**。

命令行安装（npm 包）：

```powershell
dsh plugin --profile web add dsh-topic-split
```

从 GitHub 源码安装：

```powershell
dsh plugin --profile web add github:qq666-star/dsh-topic-split
```

安装并重启后，会话输入框上方会出现「拆分 / Split」控件。

> 仓库里的 `scripts/install.ps1` / `uninstall.ps1` 只用于本地开发调试，**不随 npm 包发布**，也不建议普通用户使用。

## 配置

`apply(ctx, config)` 接受配置对象，与默认值合并后校验；非法值启动即报错并跳过注册。

| 键 | 默认 | 说明 |
|---|---|---|
| `maxCompressedBytes` | 80 MB | 会话文件压缩态上限 |
| `maxInflatedBytes` | 300 MB | 解析后内存上限 |
| `cacheEntries` | 8 | 解析缓存条数 |
| `minSegmentTurns` / `minSegmentChars` | 3 / 4000 | 主题平滑阈值 |
| `maxRanges` | 50 | 单次导出区间上限 |
| `topics` | 内置 7 组 | `[[标签, 正则字符串], …]`，模型不可用时的回退规则 |
| `semantic.backend` | `auto` | `auto` / `kernel` / `http` / `off` |
| `semantic.provider` / `model` | `deepseek-official` / `deepseek-flash` | kernel 后端用的路由 |
| `semantic.timeoutMs` | 25000 | 单次判断超时 |
| `semantic.retries` | 1 | 校验失败后的重试次数 |
| `semantic.summaryChars` | 120 | 每轮摘要字数预算 |
| `semantic.httpBaseUrl` / `httpModel` | 空 | OpenAI 兼容端点（`/chat/completions`） |
| `semantic.httpKeyEnv` | `DSH_SESSION_SPLIT_JUDGE_KEY` | 存放密钥的环境变量名 |
| `httpRoutes` | `token` | `token` / `off`：面板 HTTP 路由；`off` 时完全不注册接口 |
| `httpToken` | 空 | 面板访问令牌；留空则进程内随机生成并注入页面（推荐） |
| `httpRateLimitPerMin` | 60 | 普通请求每分钟上限 |
| `httpExportPerMin` | 6 | 导出请求每分钟上限 |
| `exposeTitles` | `true` | 面板会话列表是否返回标题（仅在令牌通过后可见） |

## 安全模式（HTTP 面板）

**默认启用，但需要令牌**：令牌默认由进程随机生成（不写盘、不写日志、不进配置），
只在通过 DSH 鉴权的 `index.html` 里以 `<meta name="dsh-split-token">` 注入，
客户端读取后附加 `x-dsh-split-token` 请求头。

因此默认体验是：面板开箱可用；未授权请求一律 `401`；非本机来源一律 `403`。

想完全关闭面板（只留 5 个 agent 工具）：

```json
{ "httpRoutes": "off" }
```

或环境变量：

```powershell
$env:DSH_SESSION_SPLIT_HTTP = 'off'
```

想固定令牌（例如某些代理场景）：

```powershell
$env:DSH_SESSION_SPLIT_HTTP_TOKEN = '自己的一串随机字符'
```

保护层次（全部默认生效）：

| 保护 | 行为 |
|---|---|
| 令牌 | 缺失/错误 → `401`；常量时间比较；支持 `x-dsh-split-token` 与 `Bearer` |
| Host | 只接受 `127.0.0.1` / `localhost` / `::1`，其余 `403`（防 DNS rebinding） |
| 连接来源 | 只接受本机 socket 地址，`PEER_NOT_ALLOWED` 拒绝局域网连接 |
| Origin | 只接受本机来源，跨站 `403` |
| `Sec-Fetch-Site` | `cross-site` / `same-site` → `403` |
| 限流 | 普通 60 次/分，导出 6 次/分，超出 `429` |
| 标题 | 默认返回，但只在令牌通过后可见；可 `exposeTitles: false` 关闭 |
| 诊断 | HTTP 接口返回的诊断隐藏主机名与本机路径 |
| 网络边界 | 只监听 DSH 自身绑定地址；不要用 `--host` 把 DSH 暴露到局域网/公网 |

**令牌怎么给到页面**：服务端在 `index.html` 的 `</head>` 前注入 meta，
只有通过 DSH 自身鉴权的页面（`/` 与 `/index.html` 无 token 均为 401）才能拿到它。
若宿主版本不支持 `tapIndex`，可手动在控制台执行：

```js
localStorage.setItem('dsh-split-token', '你的令牌')
```

## 会话登记

新建会话后需要登记到 DSH 的 workspace，才会出现在侧边栏：

- 优先调用 DSH 的 `workspaceRegistry` 服务（`attachSession` / `detachSession`）
- 服务不可用时回退文件写入，但会**先备份、后回读校验、失败回滚**，且只增删目标 id
- 不整份覆盖 `workspace.json`，避免与 DSH 内存快照互相覆盖

## 剪除（session_cut）

DSH 会话是 append-only 事件日志，**不能从中间物理删除事件**。因此「剪掉」的实现是：

1. 读取源会话的全部轮次
2. 用**剩余轮次**重建一个新会话（文字内容）
3. 可选 `archive: true`：把原会话登记进 DSH 的归档集合（`archivedSessionIds`），从列表消失，
   会话文件原地不动，随时可取消归档

> **为什么不改目录名**：DSH 读取会话列表时，会用每个会话文件头里的 `id` 与 `cwd` 重新推导
> 它应该所在的路径，并要求与实际路径一致。目录一旦被改名成 `.archived-*`，这条校验失败，
> **整份** `session/list` 报错，侧边栏的会话列表会整块消失，而且重启也不会恢复
> （0.9.1 及更早版本就踩了这个坑；插件启动时会把遗留的 `.archived-*` 目录自动改回来）。

```json
{ "sessionId": "2c609ca0", "ranges": "78-92", "dryRun": false, "archive": true }
```

也可以一步完成「导出 + 剪除」：

```json
{ "sessionId": "2c609ca0", "ranges": "78-92", "dryRun": false, "cut": true }
```

`cut: true` 时：先导出独立会话，再用剩余轮次重建主会话，最后归档原会话——主会话只剩非独立部分。

| 参数 | 默认 | 说明 |
|---|---|---|
| `dryRun` | `true` | 只返回计划，不写文件 |
| `archive` | `false` | 归档原会话（登记归档集合，目录不改名） |
| `title` | 自动 | 重建会话的标题 |

注意：

- 重建的会话**只保留文字**，工具调用记录不会带入
- 归档走 DSH 的 `workspaceRegistry.archiveSession`：会话正在运行（还有回合/子代理在跑）时
  归档会被拒绝，工具会明确告诉你「原会话未归档」，会话与目录都不受影响
- 原会话归档后仍在磁盘（`session-<id>` 下），可在列表的归档视图里取消归档或手动删除

## 精确挑选（turns）

主题在会话里往往是交错的：同一主题可能散落在几十个位置。只用连续区间（`ranges`）时，
要么漏掉同主题的散点，要么把中间的无关轮次一起带出去。

用 `turns` 可以精确挑选任意轮次：

```json
{ "sessionId": "2c609ca0", "turns": "3,7-9,20", "dryRun": true }
```

| 参数 | 说明 |
|---|---|
| `turns` | 逗号分隔，每项为单轮 `N` 或区间 `A-B`；与 `ranges` 互斥 |
| `ranges` | 连续区间（`0-51,52-87`、`78-end`）；保留不变 |

`session_export` / `session_cut` / `session_coverage` 都支持：

- 预览显示「选中 N 轮 / 多少字 / 几个连续块」与「排除 …」，并核对
  **选中 + 排除 = 源会话**（轮次与字数两个维度）
- 选中轮次不连续时会提示：导出的会话**缺少中间上下文**（物理限制，无法用代码消除）
- 重叠或相邻的输入项会自动合并，不会重复计数

> 一轮是原子单位：如果同一轮里前后半段属于不同主题，只能整轮归类。

## 判断模型（语义分段）

`mode=auto` 时优先调用判断模型给主题边界，失败自动回退关键词规则（并在输出里标注失败原因）。

- **kernel 后端**：走宿主 `ctx.llm`，复用用户已配置的模型与额度，**不需要额外密钥**
- **http 后端**：任意 OpenAI 兼容端点，密钥只从环境变量读取，不写入配置

提示词只包含每轮摘要（用户首句 + 助手首句），所以一次 200 轮会话约 2 万 token，而不是 30 万。
模型输出后由代码硬校验「从 0 开始、首尾相接、不重叠、全覆盖」；校验失败重试一次，仍失败则回退。

环境变量覆盖：

```powershell
$env:DSH_SESSION_SPLIT_JUDGE = 'off'          # 关闭模型，只用关键词
$env:DSH_SESSION_SPLIT_JUDGE = 'kernel'       # 强制内核模型
$env:DSH_SESSION_SPLIT_JUDGE_URL = 'https://api.deepseek.com/v1'
$env:DSH_SESSION_SPLIT_JUDGE_HTTP_MODEL = 'deepseek-chat'
$env:DSH_SESSION_SPLIT_JUDGE_KEY = '<key>'    # 变量名可由 httpKeyEnv 改
```

## 急停开关

| 开关 | 用法 |
|---|---|
| Host | 环境变量 `DSH_SESSION_SPLIT_DISABLE=1`，重启后不注册工具 |
| Client | `localStorage.setItem('dsh-split-disabled','1')` 后刷新 |
| Client | `window.__DSH_SESSION_SPLIT_DISABLE__ = true` |

## 测试

```powershell
npm test          # 或 node --test
```

覆盖：多帧 zstd 编解码、截断容错、分段/覆盖率、配置校验、工具成功与错误路径、前缀匹配、缓存命中、任意轮次选择（`turns` 解析/合并/互斥/越界），以及语义分段（提示词、校验、重试、回退、dryRun）。

## 目录结构

```
src/
  index.js      插件入口（配置校验 + 注册）
  config.js     默认值 + 校验
  errors.js     错误码
  log.js        分级日志（DSH_SESSION_SPLIT_DEBUG=1）
  zstd.js       多帧编解码
  store.js      路径/注册表/扫描/缓存
  topics.js     关键词分段规则与平滑
  selection.js  ranges / turns 统一成轮次集合 + 二维覆盖率
  judge.js      判断模型适配（kernel / http）+ 输出校验
  semantic.js   语义分段：模型边界 → 平滑 → 字数
  exporter.js   构造并原子写入会话
  tools.js      五个工具
client/
  index.js      React 组件，注册 conversation.input.dock
locale/         zh.json / en.json（Plugin Manager 标题与描述）
icon.svg        插件图标
test/           node:test 用例
```

## 安全设计

- 客户端通过 `conversation.input.dock` slot 注册 React 组件：不读写宿主 DOM、不 append `document.body`
- 固定浮层按宿主文档用 `createPortal`；文案走 `ctx.locale`，颜色走 `--dsw-alias-*`
- 组件内监听与定时器在卸载/关闭时清理；请求进行中禁用按钮防重复写
- HTTP 面板默认启用但强制令牌；令牌为进程内随机且只注入受鉴权的页面
- Host / 连接来源 / Origin / Sec-Fetch-Site 四重校验 + 双档限流（见上节）
- 诊断接口默认脱敏（隐藏主机名与本机路径）
- 缓存：解析结果按 mtime 缓存；压缩/解压双上限；工具异常转为 `错误[CODE]：…`
- 会话 id 白名单校验；导出路径必须落在 `~/.dsh/sessions` 内
- 新会话原子写（.tmp → rename）
- 无遥测、无外部网络请求；只有把判断模型显式配成 `http` 后端才会访问指定端点

## 已知限制

- 主题划分默认走判断模型；模型不可用时退回关键词规则，粒度较粗
- 判断模型只读每轮摘要，极短或高度混杂的段落仍可能判错，`dryRun` 可先预览再决定
- 导出的会话只含用户提问与助手回复正文，不含工具调用
- 导出结果是快照：可继续对话，但新消息不会同步回源会话
- `turns` 精确挑选会产生不连续片段：导出会话缺少中间上下文（预览会提前提示）
- 一轮是原子单位：同一轮内前后半段属于不同主题时只能整轮归类
- DSH 的会话日志是多帧 zstd，Node 的 `zstdDecompressSync` 只解第一帧，本包已按帧魔数逐段解压

## 兼容性

- Node ≥ 22（依赖 `node:zlib` 的 zstd）
- `engines.dsh`: `>=0.2.2-rc.5 <0.3.0`（当前实测运行的 DSH 版本）
- 已在 Windows + DSH `0.2.2-rc.5` 上完成：插件注册、工具调用、HTTP 鉴权、导出/剪除的宿主侧测试
- 会话目录键已与 DSH 的 `projectKey` 对齐（含 `~XXXX` 转义、251 截断）；
  Linux/macOS 的路径逻辑兼容，但**尚未在真机验证**
- **UI 渲染未验证**：当前环境无法启动浏览器（DSH 沙盒禁止命名管道），见「验证边界」


## 诊断

新会话里调用 `session_diag`，或直接看返回，包含：

- 运行环境（Node 版本、主机名）
- 路径（DSH_HOME、会话目录、注册表）及是否存在
- 已注册工具清单
- 配置摘要（上限、缓存、分段阈值、主题规则数）
- 缓存命中 / 未命中 / 最近解析耗时
- 急停开关状态
- 会话目录里是否残留 `.archived-*`（会破坏 DSH 会话列表的目录名）

### 侧边栏会话列表整块消失怎么办

先看 `~/.dsh/sessions/<工作区>/` 里有没有 `.archived-session-*` 目录：

```powershell
Get-ChildItem $env:USERPROFILE\.dsh\sessions\*\ -Directory | Where-Object Name -like '.archived-*'
```

有的话改回 `session-<id>` 即可（插件 0.9.2+ 启动时会自动改回，并打一条 `归档目录自愈` 日志）。
DSH 的 `session/list` 对每个会话文件都做「头里的 id + cwd → 期望路径」校验，
一条不通过就整份列表报错，所以侧边栏会空、重启也不恢复。

## 超时与取消

- 每个工具声明 `timeoutMs = 60000`（语义分段需要等模型，含重试）
- 工具执行接收 `AbortSignal`；已取消的调用直接返回 `错误[ABORTED]：调用已取消`
- 判断模型单次调用另有 `semantic.timeoutMs` 超时，超时记为 `JUDGE_TIMEOUT` 并回退

## 本地开发脚本（不随包发布）

```powershell
# 仅本地调试：安装（会改 profile；正式安装请用 Plugins → Add plugin）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile web

# 卸载（幂等）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile web
```

`package.json` 的 `files` 已排除 `scripts/` 与 `test/`，发布包只含运行文件、locale、图标与文档。

## 测试与 CI

```powershell
npm test         # 114 个用例：单元 + 集成 + 安全 + 客户端注册契约
npm run validate # manifest / locale / icon 静态校验
node scripts/sandbox-turns.mjs   # 临时 DSH_HOME 沙盒：连跑 3 遍也不写真实会话
npm run lint     # 代码规范（9 条规则）
npm run check    # lint + validate + test
```

`npm test` 走 `scripts/test-all.mjs`：逐个文件独立进程运行，汇总退出码。
CI 里仍可用 `node --test`（`npm run test:node`）。

## 验证边界

**已用证据（可复现）**

- 语法：全部 `.js/.mjs` 通过 `node --check`
- Manifest：`dsh.bundle.patch`、`./client`、`locale/*.json`、`icon.svg` 均存在且可解析
- 宿主侧：114 个测试（HTTP 401/403/429、turns/cut、seq 连续、源会话只读、性能预算）
- 数据不变量：源会话 SHA256 不变；写入限定在 DSH_HOME 内；原子写
- 客户端契约：`inject: ['slots','locale']`、注册 `conversation.input.dock`、zh/en 字典键一致、
  源码不含宿主 DOM 探查与 `document.body.append`

**未验证（不要据此声称可用）**

- 面板在真实浏览器中的渲染、主题明暗、390px 窄屏、键盘交互与提示语
- live slot 是否被宿主正确挂载（环境无 `cordis_inspect_query`）
- 安装后的 Plugin Manager 详情页与图标显示
- Linux/macOS 真机

> 本仓库不使用 DOM 模拟来替代浏览器验证；DOM 沙盒不能算 UI 验证。

性能预算（800 轮 / 6405 事件，实测）：冷读 138ms、缓存读 1ms、分段 23ms。

CI：`.github/workflows/ci.yml`，Windows + Ubuntu × Node 22/24，跑规范检查与测试。

## 目录结构（更新）

```
src/
  config.js  errors.js  log.js  zstd.js  store.js
  topics.js  judge.js  semantic.js  exporter.js  tools.js  diagnostics.js  index.js
client/index.js
test/        helpers.js  zstd.test.js  topics.test.js  tools.test.js
             semantic.test.js  integration.test.js  perf.test.js
scripts/     install.ps1  uninstall.ps1  profile-manifest.mjs  test-all.mjs  style-check.mjs
.github/workflows/ci.yml
```


## 代码规范

零依赖检查器（`npm run lint`），9 条规则：

| 规则 | 内容 |
|---|---|
| R1 | 禁止 `var` |
| R2 | 禁止 `==` / `!=` |
| R3 | 禁止 `debugger` |
| R4 | 禁行尾空白、Tab 缩进、CRLF |
| R5 | 文件以单个换行结尾 |
| R6 | 单行 ≤ 120 字符 |
| R7 | `src/`、`client/` 禁止 `console.log`（统一走 `log.js`） |
| R8 | `src/` 中导出必须有 JSDoc |
| R9 | 文件名 kebab-case |

编辑器约定见 `.editorconfig`（UTF-8 / LF / 2 空格 / 去行尾空白）。

提交前建议执行：

```powershell
npm run check    # = lint + test
```


## 可视化面板

控件注册在 `conversation.input.dock`（会话输入框上方），点击「拆分 / Split」打开面板。
面板按 6 步组织；文案走 `ctx.locale`（中文环境显示中英双语，英文环境显示英文）：

| 步骤 | 中文 | English |
|---|---|---|
| 1 | 选择会话，可刷新 | Choose a session, refresh |
| 2 | 选分段方式（auto / keyword / model）并获取分段 | Segmentation mode, load segments |
| 3 | 勾选分段；全选/清空；合并或各成一组 | Select segments; all/clear; merge or split |
| 4 | 手动添加：连续区间（`0-51,52-96`）或精确轮次（`3,7-9,20`） | Add ranges or exact turns |
| 5 | 查看导出分组，可删除 | Review groups, remove |
| 6 | 可勾选「导出后剪除并归档」；**必须先预览**，再导出 | Optionally remove & archive; preview is required first |

安全与交互约束：

- 切换会话会清空旧分组，避免把 A 的区间套到 B 上
- 请求进行中禁用按钮，防止双击重复创建会话
- 剪除模式必须先预览才允许导出；预览显示「剪除后主会话保留多少轮/字」
- 面板内错误按错误码显示中英提示；状态条 `role="status" aria-live="polite"`
- 焦点进入面板、Esc 关闭、关闭后焦点回到入口；固定浮层用 `createPortal` 挂到 body

面板通过 HTTP 路由工作，不依赖对话：

```
GET  /dsh-topic-split/sessions
GET  /dsh-topic-split/topics?sessionId=&mode=
POST /dsh-topic-split/preview   { sessionId, groups:[{title, ranges|turns}], cut? }
POST /dsh-topic-split/export    { sessionId, groups:[{title, ranges|turns}], dryRun?, cut? }
GET  /dsh-topic-split/diag
```

路由只读源会话；导出走原子写；参数全部校验；单次最多 10 组。
`cut: true` 时先导出各分组，再用**剩余轮次**重建主会话并归档原会话。

## 许可证

GPL-3.0-only，见 [LICENSE](LICENSE)。
