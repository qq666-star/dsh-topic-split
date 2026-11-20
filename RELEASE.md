# Release 0.12.1

## 发布结果（2026-11-21）

- npm：**`dsh-topic-split@0.12.1` 已上线（latest）**
- 安装：`npm install dsh-topic-split@0.12.1`
- 页面：https://www.npmjs.com/package/dsh-topic-split
- `dist.shasum`：`c307a8e32e32ddc10171699b436c7333aa2341b7`
- **`0.12.0` 已 deprecate**：会话切换 P0，请用 0.12.1
- `0.0.0-stage` 占位版本是 npm 暂存发布机制，**不要手动删除**
- 从 registry 下载 tarball 并安装验证通过（version/license/client 修复均在包内）

**GitHub 代码尚未推送**：远端仍只有 `Initial commit`，本地提交在 `_repo`。

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

本地 `D:\DSH-Workspace\_repo` 已包含一个提交：

```
feat: dsh-topic-split 0.12.0 (conversation topic split plugin)
```

**推送尚未完成**：当前机器没有 GitHub 凭据（无 token / SSH key / 已存凭据）。
在有登录态的终端执行一次即可：

```powershell
cd D:\DSH-Workspace\_repo
git push -u origin main
```

> 仓库与包统一使用 **GPL-3.0-only**；`LICENSE` 为仓库原有的 GPL-3.0 文本，
> `package.json` 的 `license` 已同步。npm 包的体积因此增加约 35 KB。

## 发布步骤（需要 npm 账号）

```powershell
cd D:\DSH-Workspace\dsh-topic-split
npm login            # 交互输入密码/2FA
npm publish --access public
npm view dsh-topic-split version
```

发布后建议在干净 profile 用 Plugins → Add plugin 安装 `dsh-topic-split` 走一遍面板。

## 回滚

- 发布后发现问题：`npm deprecate dsh-topic-split@0.12.0 "原因"`
- 本地已安装：Plugins → Remove，再安装上一个可用版本
- 客户端若导致启动异常：把 `client/index.js` 临时替换为 inert 模块（`loader.load` 返回 `apply(){}`）后重启
