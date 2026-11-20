# 安全说明（dsh-topic-split）

## 这份插件碰什么数据

| 数据 | 读 | 写 | 出本机 |
|---|---|---|---|
| `~/.dsh/sessions/**/session.v4.jsonl.zstd` | 是（只读源会话） | 新建独立会话文件 | 否 |
| `~/.dsh/storages/workspace.json` | 是 | 登记新会话 | 否 |
| 会话正文 | 是 | 导出时复制进新会话 | 否 |
| 会话摘要（判断模型） | 是 | 否 | 默认走 DSH 内核模型；只有显式配置 `http` 后端才发到你指定的端点 |

插件**没有遥测、没有回传通道**；`fetch` 只出现在两处：面板调用本机相对路径
`/dsh-topic-split/*`，以及你显式配置的 `semantic.httpBaseUrl`。

## 默认安全姿态

| 项 | 默认 |
|---|---|
| HTTP 面板路由 | **启用，但强制令牌**（进程内随机，只注入受鉴权页面） |
| 会话标题对外 | 返回，但仅在令牌通过后可见（`exposeTitles: false` 可关闭） |
| 诊断中的主机名/路径 | HTTP 接口返回时脱敏 |
| 监听范围 | 跟随 DSH 自身绑定（默认 `127.0.0.1`） |
| 来源校验 | Host + 连接来源 + Origin + Sec-Fetch-Site 四重校验 |
| 限流 | 普通 60 次/分，导出 6 次/分 |

想彻底不暴露 HTTP 接口：`httpRoutes: 'off'`（或 `DSH_SESSION_SPLIT_HTTP=off`）。

## 为什么自己实现鉴权

DSH 的 `webServer.register()` 注册的路由**不经过宿主自身的 token 鉴权**
（实测：`/` 与 `/api/*` 无 token 返回 401，而插件注册的路由返回 200）。
因此本插件在 `httpRoutes: 'token'` 模式下自行实现：

1. 令牌比较（常量时间），令牌可配置或进程内随机；
2. `Host` 白名单，只允许 loopback，阻断 DNS rebinding；
3. 连接对端地址校验，拒绝非本机 socket；
4. `Origin` 与 `Sec-Fetch-Site` 校验，阻断跨站请求；
5. 普通/导出两档限流；
6. 令牌通过 index.html 的 meta 注入，只有通过宿主鉴权的页面才能取得。

## 已知边界

- 若你把 `dsh web` 绑定到非 loopback 地址（`--host 0.0.0.0`、反代、隧道），
  面板路由会拒绝所有非本机 `Host`，功能不可用——这是刻意的安全取舍。
- 面板只暴露「会话元数据 + 主题标签」，**不返回消息正文**；`/export` 能创建会话文件，
  但响应只给 id。
- 判断模型若配置为 `http` 后端，会话摘要会离开本机，去向你指定的端点；
  默认 `auto` 优先用 DSH 内核模型。
- 插件运行在宿主进程内，**无法防御宿主本身被攻破**。

## 报告问题

发现安全问题请私下联系维护者（不要先开公开 issue），附：

- 插件版本、DSH 版本
- 复现步骤（能最小化最好）
- 影响：能读到什么 / 能改什么

## 发布前检查清单（给发布者）

- [ ] `npm run check` 全绿（规范 + 测试）
- [ ] 包内无本机路径、无会话 id、无 token（`grep -r "C:\\\\Users" .`）
- [ ] `package.json` 不含私人 `author`/`repository` 邮箱（或使用专用邮箱）
- [ ] npm 账号开启 2FA，发布使用 `npm publish --provenance`（如支持）
- [ ] Git 提交邮箱使用公开身份，避免真实邮箱进历史
- [ ] 截图/录屏里会话标题、URL token、文件路径已脱敏
- [ ] 默认配置保持 `httpRoutes: 'off'`
- [ ] 发布物与仓库 commit 一致（附校验和）
