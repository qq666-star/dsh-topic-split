# Release 0.12.1

## 发布结果（2026-11-21）

- npm：**`dsh-topic-split@0.12.1` 已上线（latest）**
- 安装：`npm install dsh-topic-split@0.12.1`
- 页面：https://www.npmjs.com/package/dsh-topic-split
- `dist.shasum`：`c307a8e32e32ddc10171699b436c7333aa2341b7`
- **`0.12.0` 已 deprecate**：会话切换 P0，请用 0.12.1
- `0.0.0-stage` 占位版本是 npm 暂存发布机制，**不要手动删除**
- 从 registry 下载 tarball 并安装验证通过（version/license/client 修复均在包内）

## GitHub

- `main` 已推送：`baa3162`（2 commits）
- tag：`v0.12.1` → `baa3162`；已删除错误的 `v0.12.0` / `v0.12.o`（原先都指向初始提交）
- **CI 已启用且全绿**：`.github/workflows/ci.yml`（commit `b44ae00`），
  Windows/Ubuntu/macOS × Node 22/24 六个任务全部 success。
  运行记录：https://github.com/qq666-star/dsh-topic-split/actions/runs/44892697507

## 社区市场

- GitHub topics：`dsh-plugin`、`deepseek-harness`、`topic-split`、`session-management`、`export-copy`
- dsh-plugin.org 收录申请：https://github.com/dshplugin/dsh-plugin-hub/issues/871（待审核）
- npm 包可供 DSH 插件中心一键安装
- awesome-dsh-plugin（dshmarket 安装源）PR 需等仓库创建满 24 小时
  （2026-11-21 23:26 本地时间后），条目已准备在 `market/awesome-entry.yml`

## 产物

| 项 | 值 |
|---|---|
| 包名 / 版本 | `dsh-topic-split@0.12.1` |
| tarball | `_release/dsh-topic-split-0.12.1.tgz` |
| 大小 / 文件数 | 76.1 KB / 28 |
| SHA256 | `6A346131C355870FA47738ED3B847E985312063FB66586E19D14B16B27AAEA8B` |
| 仓库 | https://github.com/qq666-star/dsh-topic-split |
| 兼容性 | Node ≥ 22；DSH `>=0.2.2-rc.5 <0.3.0` |

## 真实浏览器验收（0.12.1）

使用已安装的 `dsh-browser-plus`（真实 Electron 浏览器）+ 临时 3090 实例：

- 输入框上方出现「拆分 / Split」，`aria-haspopup=dialog`、`aria-expanded` 正确
- 面板六步标题齐全；宽度 460px，390px 视口下自适应为 358px，无横向溢出
- 源会话下拉可切到 226 轮主会话；加载分段得到 6 段、覆盖率一致
- 分组、剪除门禁（未预览时导出禁用）、预览、剪除后保留量均正常
- Esc 关闭面板且焦点回到入口
- 浅色/深色主题都使用宿主 token（白底深字 / 深底浅字）
- 控制台无插件错误
- **验收发现并修复 P0**：手动切换源会话会被同步 effect 立刻重置；0.12.1 已修

## 已验证

- 114 个测试 / 15 个文件全过（单元、集成、HTTP 鉴权、性能、客户端注册契约）
- 规范检查 40 文件 / 9 条规则全过
- `manifest: PASS`：bundle patch、client 入口、exports、files、locale meta、icon
- 服务端沙盒连跑 3 遍（临时 DSH_HOME，源会话只读）
- 真实 Host：boot 图 `inject` 已含 `@deepseek-ai/dsh-client-ui-conversation`
- tarball 在临时目录安装成功；`scripts/`、`test/` 未打包，locale/icon 存在

## 未验证

- Plugin Manager 中的标题/描述/图标显示
- Linux / macOS 真机
- 真实页面中的“导出/剪除”写盘链路（验收只做了预览，避免写入真实会话；写盘逻辑由自动化测试与沙盒覆盖）

## 仓库状态

- `main`：`07349af`（含 0.12.1 代码、文档、CI workflow）
- tag：`v0.12.1`（Release 已发布）
- GitHub Release：https://github.com/qq666-star/dsh-topic-split/releases/tag/v0.12.1
- npm：https://www.npmjs.com/package/dsh-topic-split

> 仓库与包统一使用 **GPL-3.0-only**；`LICENSE` 为仓库原有的 GPL-3.0 文本，
> `package.json` 的 `license` 已同步。npm 包的体积因此增加约 35 KB。

## 发布状态

npm 已发布 `0.12.1`（`latest`），`0.12.0` 已 deprecate。安装：

```powershell
dsh plugin --profile web add dsh-topic-split
```

## 回滚

- 发布后发现问题：`npm deprecate dsh-topic-split@0.12.0 "原因"`
- 本地已安装：Plugins → Remove，再安装上一个可用版本
- 客户端若导致启动异常：把 `client/index.js` 临时替换为 inert 模块（`loader.load` 返回 `apply(){}`）后重启
