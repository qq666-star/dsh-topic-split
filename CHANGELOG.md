# Changelog

## 0.12.1 — 2026-11-21

### 修复：手动切换“源会话”被立刻重置（P0，真实浏览器验收发现）

- 面板里的会话下拉原本只用于展示；选择另一个会话后，同步 effect 会立刻把
  `sessionId` 拉回宿主当前会话，导致“获取分段”始终读取当前空会话
- 现在只在**宿主当前会话变化**时同步，手动选择源会话会保留
- 该问题由真实浏览器验收（`dsh-browser-plus` + 临时 3090 实例）发现；
  0.12.0 仍含此 bug，请升级到 0.12.1

### 修复：部分选择时的覆盖率文案

- 只选了一部分轮次时，预览不再显示“覆盖率不一致”，改为
  「本次选择覆盖 / Selected coverage: N/M」
- 只有出现重叠时仍显示「覆盖率不一致 / Coverage mismatch」

### 验证

- 真实浏览器：面板渲染、六步标题、会话切换、226 轮分 6 段、分组、剪除门禁、
  预览、Esc 关闭与焦点回归、390px 窄屏、浅色/深色主题、控制台无插件错误
- 114 个自动化测试 / 9 条规范 / manifest 校验保持通过

## 0.12.0 — 2026-11-20

### 定位文案：名称保留，描述说全

- 名称仍是 `dsh-topic-split`；描述改为「按主题或任意轮次挑选并导出为可继续的独立会话」
- 入口文案「对话独立 / Split」→「拆分 / Split」；面板标题改为「按主题拆分会话 / Split by topic」
- locale `meta.description` 同步补上「任意轮次、剪除归档、不是分屏」

### 发布合规：客户端迁到 slot + React + locale + 主题 token

- 删除全部宿主 DOM 探查（`querySelector('[aria-label…]')`）、`insertAdjacentElement`
  与 `document.body.append`；不再改输入框 placeholder
- 入口改为注册 `conversation.input.dock`（输入框上方）的 React 组件：
  `ctx.slots.inject` + `ctx.slots.register`；固定浮层按宿主文档用 `createPortal`
- 文案走 `ctx.locale.register('dsh-topic-split', { zh, en })` 与 `ctx.locale.bind`；
  中文环境显示中英双语，英文环境显示英文
- 颜色改用 `--dsw-alias-*` 主题 token，不再硬编码深色
- 移除 `hintText` / `chipLabel` / `chipLabelActive` 三个已失效配置

### UX 修复

- **会话切换清空旧分组**（原先会把 A 的区间静默套到 B 上）
- 剪除模式必须先预览；导出按钮在未预览时显示「请先预览」并禁用
- 请求进行中禁用按钮，防止双击创建两份会话；导出成功后清空分组
- 状态条改为顶部 sticky，`role="status" aria-live="polite"`
- 焦点进入面板、Esc 关闭、关闭后焦点回到入口；补 `aria-haspopup/expanded/controls`
- 「连续区间 / 精确轮次」合并为一个输入 + 显式模式选择
- 服务端错误按错误码映射为双语提示
- 覆盖率标签按 `coverage.ok` 显示「一致 / 不一致」，不再无条件说一致
- 会话列表刷新导致当前会话回退时重置计划，避免旧分组套到新会话
- 剪除导出成功后提示「请到侧栏打开新的主会话；当前页面仍是已归档原会话」
- 数值单位按语言显示（轮/字 或 turns/chars）；`source` 也做双语映射
- 面板宽度 `min(460px, calc(100vw - 32px))`，去掉内层多层滚动
- 步骤标题改为 heading；外部点击关闭不再抢焦点；`order` 改为 21
- `dsh.client.inject` 声明 `@deepseek-ai/dsh-client-ui-conversation`

### 发布元数据与生命周期

- `engines.dsh`: `>=0.2.2-rc.5 <0.3.0`；删除不被内核读取的 `dsh.compatibility`
- 新增 `locale/zh.json`、`locale/en.json`（`meta.title` / `meta.description`）与 `icon.svg`；
  `exports` 增加 `./locale/*.json`、`./icon`；`files` 收窄到运行文件 + 文档
- 新增 `keywords`、`publishConfig`
- 宿主工具注册、HTTP 路由注册、动态注入都改为 `ctx.effect` 持有 disposer，
  卸载时统一释放
- 安装文档改为官方 `Plugins → Add plugin`；`scripts/install.ps1` 标注为本地开发且不随包发布

### 验证与测试

- 新增 `scripts/validate-manifest.mjs`：bundle patch、client 入口、exports、files、
  locale meta、icon 大小与 SVG 类型
- 新增 `test/client-contract.test.js`：模块导出、slot 注册、locale 字典键一致、
  源码不含宿主 DOM 探查（**注册契约测试，不是 UI 验证**）
- 客户端 loader / factory / apply 三层兜底：缺失或抛错时降级为 inert/跳过，不拖垮 `web boot`
- 移除 Node DOM 沙盒：按官方 `verification.md`，DOM 模拟不得替代浏览器验证
- 测试 110 → 114；明确「验证边界」：UI 渲染、live slot、主题与窄屏未验证

### 许可证

- 仓库与 npm 包统一为 **GPL-3.0-only**；`package.json` 的 `license` 同步，
  `LICENSE` 使用仓库原有的 GPL-3.0 文本

## 0.11.0 — 2026-11-20

### 重写面板：中英双语、6 步流程、支持精确轮次与剪除

- 客户端面板按步骤重排：1 选会话 → 2 分段方式 → 3 勾选分段 → 4 手动添加 →
  5 导出分组 → 6 预览/导出；所有静态文案中英双语（`中文 / English`）
- 新增「精确轮次」输入（`3,7-9,20`）与「连续区间」输入（`0-51,52-96`）两个独立入口
- 新增「导出后从原会话剪除并归档」开关，面板可直接触发 `cut`
- 新增全选/清空、分组删除、分组计数、覆盖率摘要、Esc 关闭
- 面板接口 `preview` / `export` 支持每组 `turns`，并返回 `duplicateTurns` 重叠统计；
  `preview` 在 `cut: true` 时额外返回「剪除后主会话保留多少轮/字」
- `export` 支持 `cut: true`：导出后重建主会话并归档原会话
- 新增客户端交互沙盒（已在 0.12.0 移除：DOM 模拟不得替代浏览器验证）
- 新增 3 个路由用例（turns 分组、重叠统计、cut 重建）；测试 107 → 110
- 兼容：旧的 `ranges` 分组与输出格式保持不变

## 0.10.0 — 2026-11-20

### 新增：任意轮次选择（turns），解决「主题交错时切不准」

- `session_export` / `session_cut` / `session_coverage` 新增 `turns`：
  逗号分隔，每项为单轮 `N` 或区间 `A-B`（如 `3,7-9,20`），与 `ranges` 互斥
- 背景：主题在长会话里是交错的（实测 226 轮会话中，同一主题分散在 14–30 个连续块），
  只用连续区间时必然「该独立的没独立、无关的也被带出去」
- `session_coverage` 改为二维核对：`选中 + 排除 = 全部`（轮次与字数双维度）
- `dryRun` 预览新增：选中轮数/字数、连续块数与具体区间、排除量、上下文缺失提示
- `ranges` 的重叠/相邻项现在会合并，不再重复计数
- 新增错误码 `TURNS_INVALID`（格式/越界/与 ranges 冲突）
- 新增 `src/selection.js`（区间与轮次统一成有序集合 + 二维覆盖率）
- 新增 `scripts/sandbox-turns.mjs`：临时 DSH_HOME 内验证只读、结构合法性、连跑稳定性
- 新增 `test/selection.test.js`（15 个用例）；测试 92 → 107
- 兼容：`ranges` 用法与输出格式保持兼容（仅在输入重叠时有行为修正）

## 0.9.2 — 2026-11-20

### 修复：归档不再重命名会话目录（侧边栏会话列表整块消失的根因）

- 归档改为调用 DSH 的 `workspaceRegistry.archiveSession`：只把 id 记进
  `global.archivedSessionIds`，会话目录与文件名保持 `session-<id>` 不变
- 移除 `cut.archiveSessionDir`（把目录改名成 `.archived-<id>-<时间戳>`）。
  DSH 的 `session/list` 会用会话文件头里的 `id` + `cwd` 推导期望路径并要求一致，
  目录一改名就报 `corrupt session log`，**整份列表**读取失败 → 侧边栏会话列表
  整块消失，且重启后依旧（坏的是磁盘状态），这就是用户反复遇到的「一重启就消失」
- 归档被 DSH 拒绝时（例如会话还在跑）明确报「原会话未归档」，不再退回改名/写文件
- 新增启动自愈 `src/repair.js`：把遗留的 `.archived-session-*` 目录自动改回
  `session-<id>`，并在日志里打 `归档目录自愈`
- `session_diag` 新增「归档目录」一节：发现残留 `.archived-*` 会直接告警
- 新增 `test/repair.test.js`（3 个用例）；`cut` / `registry` 用例改为断言「目录不改名」
- 测试 86 → 92

## 0.9.0 — 2026-11-20

### 修复：会话登记不再写坏 workspace.json

- 新建会话的登记改为优先调用 DSH 的 `workspaceRegistry` 服务
  （`resolveByPath(cwd).attachSession(id)` / `detachSession(id)`）
- 文件写入只作为兜底，且改为：备份 → 读-改-写 → 回读校验 → 失败回滚
- 兜底路径只增删目标 id，绝不整份覆盖其它条目
- `exporter.createSession` 不再自己登记；由工具/路由调用登记器
- 修复前：直接整份改写 `workspace.json`，会被 DSH 内存快照覆盖，
  导致插件创建的会话从侧边栏消失
- 新增 `src/registry.js` 与 `test/registry.test.js`（4 个用例）
- 测试 83 → 86

## 0.8.2 — 2026-11-20

### 新增：区间支持 `end`

- `ranges` 现在支持 `78-end`（等价于从 78 到最后一轮），方便「剪到当前这句话」
- `session_export` / `session_cut` / `session_coverage` 共用同一解析器
- 新增解析用例（`2-end`、`8-end`）

## 0.8.1 — 2026-11-20

### 新增：导出并剪除一步完成

- `session_export` 新增 `cut` 参数：导出成功后用剩余轮次重建主会话，并归档原会话
- 主会话只保留「非独立部分」；独立部分进入新会话
- `dryRun` 时会同时预告剪除计划
- 拒绝剪除后主会话为空的请求
- 测试 81 → 83

## 0.8.0 — 2026-11-20

### 新增：剪除（session_cut）

- 新工具 `session_cut`：把指定轮次从会话中剪掉，用剩余轮次重建新会话
- 默认 `dryRun`（只预览）；`archive: true` 时把原会话目录归档并从列表移除
- 原因：DSH 会话是 append-only 事件流，不能物理删除中间事件；重建是唯一安全做法
- 已知限制：重建会话只保留文字，工具调用记录不保留
- 新增 `src/cut.js`（`planCut` / `archiveSessionDir` / `toPairs`）
- 新增 `store.unregisterSession`：归档后从 workspace 注册表移除
- 测试 76 → 81（新增 `test/cut.test.js` 5 个用例）

## 0.7.1 — 2026-11-19

### 修复（自查 + 输入法防护）

- **输入法保护**：监听 `compositionstart/compositionend`，组合输入期间冻结一切 DOM 写入，
  避免与编辑器（Lexical contenteditable）抢 DOM 导致组合态被打断
- **拒绝进入可编辑区**：锚点若位于 `[contenteditable="true"]` 内，跳过芯片插入
- **芯片绘制幂等**：文案/样式只有变化时才写，减少每次 tick 的样式重算
- **崩溃修复**：面板会话列表在 `exposeTitles=false` 时 `row.title` 为 undefined 会抛错，
  现在用 id 兜底
- **加载标记时序**：`__DSH_TOPIC_SPLIT_LOADED__` 改为 `loader.load` 成功后才置位，
  失败时复位，避免一次失败后永久无法重试；`dispose` 时复位以支持热重载
- **观察器清理**：切换观察目标时移除旧节点的 `data-dsh-split-scope` 标记
- **面板错误处理**：`toggle()` 的异步异常不再产生未处理 Promise 拒绝

### 修复（服务端路径语义）

- 新增 `samePath` / `isInsideRoot`：Windows 大小写不敏感、POSIX 敏感
  - `assertInsideRoot` 之前用 `startsWith`，在 Windows 上大小写不同会被误判为越界
  - `registerSession` 之前无条件 `toLowerCase()`，在 Linux 上会把不同目录误合并
- `samePath` 拒绝空路径（避免 `resolve('')` 变成当前目录导致误匹配）
- 测试 72 → 76（新增 `test/path.test.js`）

## 0.7.0 — 2026-11-19

### 改名：dsh-topic-split

- 包名 `dsh-session-split-secure` → **`dsh-topic-split`**
  - 去掉 `-secure`：安全是配置项（`httpRoutes: off`），不需要两个包
  - `topic` 突显功能，避开生态里 `split-view` / `split-screen` 等分屏插件的搜索污染
- HTTP 前缀 `/dsh-session-split` → `/dsh-topic-split`
- 客户端 loader id、全局标记、日志标签同步
- 安装/卸载脚本的联接名同步（`profile-manifest.mjs` 仍从 package.json 读包名）
- README 顶部明确「不是分屏插件」

## 0.6.4 — 2026-11-18

### 跨平台：项目目录键对齐 DSH

- `slugFor` 改为与 DSH `projectKey` 完全一致的实现：
  分隔符折叠、不安全码元转 `~XXXX`、截断 251、空路径回退 `root`
- 修复：Linux/macOS 下含空格、中文、`~` 或超长的工作目录会生成错误的
  会话目录名，导致导出的会话落到 DSH 不认识的位置（Windows 简单路径此前
  恰好一致，所以没暴露）
- `createSession` 空 cwd 回退当前目录（DSH 的 `projectKey` 不接受空路径）
- 新增 `test/slug.test.js`：9 组基准值、分隔符折叠、空值、超长截断、字符白名单
- 测试 66 → 72

## 0.6.3 — 2026-11-13

### 发布准备

- 兼容性声明改为实测版本：`0.2.2-rc.1`（当前运行版本）与 `0.2.1-rc.2`
- 发布前审计：包内无本机路径、主机名、会话 id、真实 token（仅元数据调整，无代码改动）

## 0.6.2 — 2026-11-13

### 修复

- `inject` 只声明 `tools` 后，`ctx.webServer` 在未注入时取不到，导致面板路由被静默跳过
  （日志：`没有 webServer 服务`）。改为用 cordis 的动态注入 `ctx.inject(['webServer'], …)`
  等 webServer 就绪再注册；工具注册不受影响
- 新增用例覆盖动态注入路径（测试 65 → 66）

## 0.6.1 — 2026-11-13

### 功能齐全 + 安全默认

- `httpRoutes` 默认改为 `token`：面板开箱可用；令牌由进程随机生成，
  只注入受 DSH 鉴权的 `index.html`，不写盘、不写日志、不进配置
- `exposeTitles` 默认改为 `true`（标题仅在令牌通过后可见，可用 `false` 关闭）
- 新增连接来源校验：非本机 socket 地址 → `PEER_NOT_ALLOWED`
- 新增 `Sec-Fetch-Site` 校验：`cross-site` / `same-site` → `CROSS_SITE`
- 客户端 401 提示改为「令牌随进程重启轮换，请刷新页面」
- 测试 62 → 65

## 0.6.0 — 2026-11-13

### 安全：HTTP 面板默认关闭 + 令牌鉴权

- **破坏性变更**：`httpRoutes` 默认 `off`。默认只注册 agent 工具，不监听任何 HTTP 路由
- 开启方式：`httpRoutes: 'token'` + `httpToken`（或环境变量 `DSH_SESSION_SPLIT_HTTP_TOKEN`）
- 未给令牌时在进程内随机生成，并通过 `tapIndex` 注入 index.html 的
  `<meta name="dsh-split-token">`；客户端自动读取并附加 `x-dsh-split-token`
- 校验 `Host`（只允许 127.0.0.1 / localhost / ::1）与 `Origin`，阻断 DNS rebinding 与跨站请求
- 限流：普通 60 次/分、导出 6 次/分（可配）
- 会话标题默认不返回（`exposeTitles: false`）
- HTTP 诊断接口默认脱敏（隐藏主机名与本机路径）
- 包名改为 `dsh-session-split-secure`，可与原版并存；客户端 loader id 与日志标签同步更名

### 其它

- `profile-manifest.mjs` 从 `package.json` 读取包名，避免改名后脚本仍指向旧包
- 新增 `SECURITY.md`（数据流、威胁模型、发布前检查清单）
- 测试从 40 增至 62（新增 HTTP 鉴权、Host/Origin、限流、meta 注入、标题隐藏、诊断脱敏）

## 0.5.0 — 2026-11-08

### 新增：可视化面板（真正触发导出）

- 客户端新增面板：选会话 → 拉分段 → 勾选 → 合并/各自成组 → 手输区间 → 预览 → 导出
- 面板挂在 `document.body` 上，不进入 React 树
- 芯片与面板联动：打开面板时输入框提示语切换

### 新增：HTTP 路由（host 半）

- `GET  /dsh-session-split/sessions` 会话列表
- `GET  /dsh-session-split/topics?sessionId=&mode=` 分段与覆盖率
- `POST /dsh-session-split/preview` 组计划预览（不写文件）
- `POST /dsh-session-split/export` 真正导出（支持 dryRun）
- `GET  /dsh-session-split/diag` 自检
- 参数白名单校验、单次最多 10 组、请求体上限 256KB

### 其他

- `inject` 增加 `webServer`（没有它路由注册不了）
- `resolveTopics` 提取为 `createResolveTopics` 供路由复用
- 新增 `test/routes.test.js`（7 个用例，含 dryRun 不写文件、非法参数 400、未知路由 404）

## 0.4.1 — 2026-11-08

### 修复

- kernel 判断后端只收 `text-delta`，部分适配器只在 `block-end` 给完整文本，导致
  `JUDGE_BAD_OUTPUT：内核模型没有返回文本`；现在两种都收（有 delta 时优先用 delta）
- 模型以 `finish.error` / `aborted` / `max-tokens` 结束时，失败原因直接透出
  （`JUDGE_UNAVAILABLE` / `ABORTED` 等），不再是笼统的“没有返回文本”

## 0.4.0 — 2026-11-08

### 新增：判断模型（语义分段）

- `judge.js`：kernel（`ctx.llm`，复用宿主模型，无需密钥）/ http（OpenAI 兼容端点）两种后端
- 提示词只喂每轮摘要，200 轮会话约 2 万 token；输出 JSON 后由代码硬校验
  「从 0 开始、首尾相接、不重叠、全覆盖」
- 校验失败重试一次（`semantic.retries`），仍失败回退关键词规则并标注原因
- `session_topics` 新增 `mode`（`auto` / `model` / `keyword`）
- 过短段自动并入相邻段（`semantic.js:smoothSegments`）
- 新增错误码 `JUDGE_UNAVAILABLE` / `JUDGE_TIMEOUT` / `JUDGE_BAD_OUTPUT` / `ABORTED`

### 新增：导出预览（dryRun）

- `session_export` 新增 `dryRun`：只返回计划，不写任何文件
- `dryRun` 时可省略 `ranges`，按主题分段逐段给出「将新建 N 个会话」的计划
- 预览包含区间、主题名、轮次、字数

### 其他

- `session_diag` 增加判断模型状态（后端、路由、超时、重试）
- 工具超时从 30s 调整为 45s（语义分段需要等模型）
- 新增 `scripts/test-all.mjs`：逐文件独立进程跑测试（受限环境无法 spawn 管道时可用）
- 测试从 28 个增至 41 个

## 0.3.2 — 2026-11-08

### 修复

- `output.render` 改为返回内容块数组（`[{type:'text', text}]`），修复真实宿主调用时报
  `content.some is not a function`
- 新增契约测试：所有工具的 render 必须返回非空内容块数组

## 0.3.1 — 2026-11-08

### 代码规范

- 新增零依赖规范检查器 `scripts/style-check.mjs`（9 条规则）
- 全仓规范化：去掉 `var`、统一 LF、清除行尾空白、行宽 ≤ 120、导出补 JSDoc
- 新增 `.editorconfig` / `.gitattributes`
- `npm run lint` / `npm run check`，CI 增加规范检查步骤

## 0.3.0 — 2026-11-08

### 企业级工程化（P1/P2）

- 新增 `session_diag` 自检工具：路径、配置、缓存命中率、运行环境、开关状态
- 工具声明 `timeoutMs`（30s）并支持 `AbortSignal`（已取消的调用直接返回 `ABORTED`）
- 会话读取器新增统计：命中 / 未命中 / 最近解析耗时
- 新增集成测试（注册、取消、禁用开关、tools 缺失降级）
- 新增性能预算测试（800 轮：冷读 < 3000ms、缓存 < 20ms、分段 < 1000ms）
- 新增 `scripts/install.ps1` / `scripts/uninstall.ps1`：幂等、自动备份、失败回滚
- 新增 GitHub Actions CI（Windows + Ubuntu，Node 22/24）

## 0.2.1 — 2026-11-08

### 修复（关键）

导出的会话缺少真实会话的头部与注入事件，被 GUI 继续对话时会损坏：

- 增加头部事件：`permission/preset`、`sandbox/mode`、`approval/policy`、`session/end-seed`
- 每轮增加 `agent/inbox/spliced`（插入 + 移除）
- 第 1 轮增加 `system/message`（含 `id`、`source: {kind:'system-prompt'}`、`surfaceOp`）
- 新增结构断言测试：头部顺序、system/message 位置、注入配对、seq 连续

修复前会被 DSH 判为：
`system/message requires a protected first surface head` / `seq gap`

## 0.2.0 — 2026-11-08

### 重构（P0 工业化）

- 拆分为 `src/`（9 个职责单一模块）与 `client/`（2 个模块）
- 新增配置层：所有阈值、主题规则、文案可配置，非法值启动即报错
- 新增错误码（`SESSION_NOT_FOUND` / `RANGE_INVALID` / `FILE_TOO_LARGE` 等）
- 新增分级日志，`DSH_SESSION_SPLIT_DEBUG=1` 输出 debug 详情
- 新增自带测试（`npm test`，node:test）
- 新增 LICENSE、CHANGELOG

### 修复

- 多帧 zstd 只解第一帧导致工具读到 0 轮（按帧魔数逐段解压）
- Node 侧解压后内存无上限

### 安全

- 会话 id 白名单校验，导出路径必须落在 `~/.dsh/sessions` 内
- 新会话改为「先写 .tmp 再 rename」的原子写

## 0.1.1 — 2026-11-08

- 修复客户端模块未声明 `exports` 导致 `web boot: 1 entry did not activate`（白屏）
- 不再注册 `conversation.input.permission` 插槽（避免顶掉「工作区内修改」）
- 客户端改为 DOM 注入 + 200ms 防抖 + 后台暂停
- 新增双急停开关（环境变量 / localStorage）

## 0.1.0 — 2026-11-08

- 首个可用版本：`session_topics` / `session_export` / `session_coverage` 三个工具
- 输入框「对话独立」入口
