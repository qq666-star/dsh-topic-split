# 安装、卸载与排障

## 安装（推荐）

1. 打开 DSH → **Plugins → Add plugin**
2. 选择本目录（本地开发），或选择已发布的包名 `dsh-topic-split`
3. 按提示批准安装（如出现 build 脚本审批）
4. 重启 `dsh web`
5. 会话输入框上方出现「拆分 / Split」控件

> 不要手工改 `profiles/<name>/package.json` 或 `cordis.patch.yml`：
> 官方安装会完成依赖、bundle 选择、兼容性检查与 lockfile 记录。

## 卸载

Plugins → 找到 `dsh-topic-split` → Remove，然后重启 `dsh web`。

## 兼容性

- 需要 Node ≥ 22
- 需要 DSH `>=0.2.2-rc.5 <0.3.0`（`engines.dsh` 声明；不满足时安装会被拒绝）
- Windows 已实测；Linux/macOS 路径逻辑兼容但未真机验证

## 验证插件是否工作

1. 新会话里让 agent 调用 `session_diag`：应输出路径、配置、缓存与判断模型状态
2. 浏览器直接访问 `http://127.0.0.1:3080/dsh-topic-split/sessions`：应返回 `401`
3. 打开「拆分」面板，先「预览」再「导出」（写盘前先确认计划）

## 排障

| 现象 | 处理 |
|---|---|
| 面板返回 `401` | 令牌随进程重启轮换：刷新页面重试 |
| 面板返回 `404` | `httpRoutes=off`：设置 `DSH_SESSION_SPLIT_HTTP=token` 后重启 |
| 面板返回 `403` | 只允许本机访问；检查是否通过反代/局域网访问 |
| 会话列表整块消失 | 检查 `~/.dsh/sessions/<工作区>/` 是否有 `.archived-*` 目录；0.9.2+ 启动会自动改回 |
| 安装被拒（兼容性） | 升级/降级 DSH 到 `engines.dsh` 允许的范围 |

## 验证边界

本包的 UI 渲染（面板外观、主题明暗、窄屏、键盘交互）在当前开发环境**未经浏览器验证**
（沙盒禁止命名管道，Chromium/Edge 无法启动）。宿主侧逻辑、HTTP 行为、会话结构有自动化测试，
但不要把“注册成功”当作“界面正确”。

## 开发脚本（不随 npm 包发布）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile web
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile web
```

这两个脚本只用于本地调试，会直接改 profile 配置；正式安装请用 Plugins → Add plugin。
