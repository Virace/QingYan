# QingYan 配置说明

QingYan 当前处于未发布阶段，本轮配置模型按 hard cut 收口：配置文件只负责进程启动前必须知道的部署信息；站点、站点设置、系统设置和后台 bootstrap 状态由数据库持久化。首次部署推荐走 install-first 流程，而不是手写完整业务 YAML。

## 配置所有权

QingYan 把配置来源分成四类：

- `startup config`：YAML 文件，包含 server、database、admin session 和基础 security 字段。修改后通常需要重启。
- `env override`：白名单环境变量覆盖 startup config 或 install 行为。环境变量优先级高于 YAML。
- `db site settings`：数据库中的站点记录与 `site_settings`，包含评论开关、审核默认状态、验证码模式、评论身份字段、页面点赞、通知开关、评论元数据采集等。
- `db system settings`：数据库中的 `system_settings`，包含日志等级、日志保留天数、mail SMTP、captcha provider/config、IP 库下载与更新等不影响进程启动的全局能力设置。
- `generated bootstrap`：安装器生成并写入数据库的一次性后台入口、管理员用户名、密码 hash 等初始化状态。

配置文件不再长期拥有 `sites[]`、`sites[].defaults`、mail、captcha provider、IP 库、日志等级或保留天数。后台管理端修改站点设置后写入数据库，重启不会被 YAML 覆盖。

## 首次安装

如果 `QINGYAN_CONFIG_PATH` 指向的配置文件不存在，服务会进入 minimal install app。启动日志会输出一次性安装地址：

```text
install.url=http://127.0.0.1:4401/qingyan/admin/install
```

浏览器访问 `/qingyan/admin/` 或 `/qingyan/admin/install` 完成安装。安装 token 由 install page 通过 HttpOnly cookie 处理，不显示在 URL 或页面正文中；脚本化安装仍可显式提交 token。

安装接口会写入 startup config、初始化 SQLite、执行 migrations、写入 admin bootstrap、默认站点、默认 `site_settings`、完整默认 `system_settings`，并在 startup config 同目录写入 `qingyan.installed.lock` 安装锁。安装期间不启用管理员登录，默认后台入口 `/qingyan/admin` 会跳转到安装页 `/qingyan/admin/install`，正常 `/qingyan/api/*` 接口不会注册；安装完成后按 `QINGYAN_INSTALL_TRANSITION_MODE` 切换到正常服务，安装锁存在时不会启动 install app，正常后台中的 `${server.publicPath}${admin.consolePath}/install` 只返回已关闭提示。安装完成后的后台入口由 `server.publicPath + admin.consolePath` 组成，`admin.consolePath` 本身仍只表示 QingYan 内部后台路径，例如 `/admin` 或 `/hidden-admin`。

startup 环境变量会覆盖安装表单中对应字段，并在安装计划中标记来源。secret 环境变量只显示“已配置”；当前支持把 `QINGYAN_SMTP_PASSWORD` 与 `QINGYAN_TURNSTILE_SECRET_KEY` 作为首装 seed 写入 `system_settings`，响应中不会返回明文。如果目标 startup config 已存在但无效，安装器会在替换前创建同目录 `.bak-YYYYMMDDHHmmss` 备份。

安装相关环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `QINGYAN_CONFIG_PATH` | startup config 路径，默认 `config/qingyan.yml` |
| `QINGYAN_INSTALL_TOKEN` | 指定安装 token；不指定时启动时随机生成 |
| `QINGYAN_INSTALL_DISABLED=true` | 缺配置或坏配置时直接失败，不开放 install app |
| `QINGYAN_INSTALL_TRANSITION_MODE` | 安装完成后的切换方式：`reload_in_process`、`exit_for_supervisor` 或 `manual`，默认 `reload_in_process` |
| `QINGYAN_SERVER_HOST` | install app 监听 host |
| `QINGYAN_SERVER_PORT` | install app 监听 port |
| `QINGYAN_PUBLIC_PATH` | QingYan 对外挂载路径，默认 `/qingyan`，必须是非根路径 |

旧变量 `QINGYAN_INSTALL_RESTART_MODE=exit` 仍会兼容映射为 `exit_for_supervisor`，但新部署应使用 `QINGYAN_INSTALL_TRANSITION_MODE`。Web 安装接口不会调用 `qyctl`、`systemctl` 或任意外部 shell 命令；Docker Compose 可用 `exit_for_supervisor` 交给 restart policy 拉起，直接部署或托管运行时通常使用默认的 `reload_in_process`。

## Startup Config

最小 startup config 形态如下，示例文件见 `config/qingyan.example.yml`：

```yaml
server:
  host: 0.0.0.0
  port: 4401
  publicBaseUrl: http://localhost:4401
  publicPath: /qingyan
  trustProxy: false

database:
  client: sqlite
  sqlite:
    file: ./data/qingyan.db

admin:
  session:
    cookieName: qingyan_admin
    ttlMinutes: 4320
    sameSite: lax
    secure: false

security:
  requestIdHeader: x-request-id
  globalFloodGuard:
    enabled: false
    windowSec: 10
    maxRequests: 120
  publicOriginGuard:
    enabled: true
    allowMissingOrigin: false
  rateLimit:
    adminLogin:
      windowSec: 600
      maxFailures: 5
    commentCreate:
      windowSec: 300
      maxRequests: 5
    commentVote:
      windowSec: 300
      maxRequests: 15
    captchaVerify:
      windowSec: 300
      maxFailures: 8
    pageLike:
      windowSec: 300
      maxRequests: 10
```

### `server`

- `host`: Fastify 监听地址。
- `port`: Fastify 监听端口。
- `publicBaseUrl`: 对外公开 origin，应与用户浏览器实际访问 QingYan 的网关或反代入口一致，不包含 QingYan 挂载路径。Docker 内部默认 `http://localhost:4401` 通常不是生产反代后的公开地址。
- `publicPath`: QingYan 对外挂载路径，默认 `/qingyan`，必须是非根路径。`qingyan`、`/qingyan` 和 `/qingyan/` 会规范化为 `/qingyan`。公开 API、Admin、Install、Upgrade、OpenAPI、health check 和 QingYan cookie path 都会使用该前缀。修改后必须同步调整反向代理 location/path rewrite。
- `trustProxy`: 部署在 CDN、Nginx、Caddy、Traefik 或 Docker 反向代理后时设为 `true`，否则真实 IP 解析可能拿到代理或网桥地址。

### `database`

当前仅支持 SQLite。`database.sqlite.file` 支持相对路径，按进程工作目录解析。

### `admin.session`

- `cookieName`: 后台 cookie 名。
- `ttlMinutes`: 会话有效期。
- `sameSite`: `strict | lax | none`。
- `secure`: HTTPS 环境建议设为 `true`。

管理员入口、用户名和密码 hash 不再写在 startup config 中，由 install 写入数据库 bootstrap 状态。

### `security`

- `requestIdHeader`: 外部请求链路传入 request id 时使用的 header 名。
- `globalFloodGuard`: 进程级总请求洪峰保护。
- `publicOriginGuard`: 公开写接口的浏览器来源保护。
- `rateLimit`: 评论、投票、验证码和页面点赞限流参数。

`publicOriginGuard` 使用请求体或查询参数中的 `siteKey` 查找数据库站点 `allowedOrigins`。`Origin` / CORS 是浏览器侧来源门禁，不是 API 密钥；公开写接口仍然需要验证码、限流、黑名单和审核策略承受直接调用。

## 环境变量白名单

当前 startup config 支持的环境变量映射集中在 `src/config/env-mapping.ts`。常用变量：

| 配置路径 | 环境变量 | 说明 |
| --- | --- | --- |
| `server.host` | `QINGYAN_SERVER_HOST` | 启动监听地址 |
| `server.port` | `QINGYAN_SERVER_PORT` | 启动监听端口 |
| `server.publicBaseUrl` | `QINGYAN_PUBLIC_BASE_URL` | 对外公开基础地址 |
| `server.publicPath` | `QINGYAN_PUBLIC_PATH` | 对外挂载路径，默认 `/qingyan` |
| `server.trustProxy` | `QINGYAN_TRUST_PROXY` | 是否信任反向代理 |
| `database.sqlite.file` | `QINGYAN_SQLITE_FILE` | SQLite 文件路径 |
| `admin.session.cookieName` | `QINGYAN_ADMIN_SESSION_COOKIE_NAME` | 后台会话 cookie 名 |
| `admin.session.ttlMinutes` | `QINGYAN_ADMIN_SESSION_TTL_MINUTES` | 首装时写入 `system_settings`，后台会话有效期，单位分钟 |
| `admin.session.sameSite` | `QINGYAN_ADMIN_SESSION_SAME_SITE` | `strict | lax | none` |
| `admin.session.secure` | `QINGYAN_ADMIN_SESSION_SECURE` | 是否仅通过 HTTPS 发送后台 cookie |
| `mail.smtp.password` | `QINGYAN_SMTP_PASSWORD` | 首装时写入 `system_settings`，响应脱敏 |
| `captcha.turnstile.secretKey` | `QINGYAN_TURNSTILE_SECRET_KEY` | 首装时写入 `system_settings`，响应脱敏 |

环境变量管理的字段在 install 或后续配置查看中应作为 env source 展示。secret 类型字段只显示“已配置”，不展示明文。

安装页会尽量以当前浏览器访问地址填充 `server.publicBaseUrl` 和初始 `allowedOrigins`，并按当前协议默认设置 HTTPS Secure Cookie：`https:` 默认启用，`http:` 本地测试默认不启用。用户手动修改后，页面不再覆盖该字段。

## DB-Owned Site Settings

每个站点由数据库 `sites` 表持久化：

- `siteKey`
- `name`
- `allowedOrigins`

每个站点的行为由 `site_settings` 持久化，并通过 QingYan 自带 Admin Console 维护。对应的 `${server.publicPath}/api/admin/*` 路径不纳入公开 OpenAPI；开发者调试或扩展内置后台时可参考 `docs/admin-console-api.md`。

站点设置包含：

- 评论开关、默认审核状态、最大嵌套深度、分页上限。
- 评论身份字段：`nickname | email | website` 的允许和必填状态。
- 可信评论作者：`comments.verifiedAuthor.enabled`、`displayName`、`email`、`website`、`badgeLabel`，用于管理员或楼主这类已验证来源回复。
- 验证码模式：`never | always | threshold` 及阈值窗口。
- 滥用保护和自动黑名单策略。
- 评论请求元数据采集：IP、User-Agent、是否启用 IP 属地、属地显示精度、设备解析。
- 页面点赞开关。
- 邮件通知开关。

这些字段不再从 YAML 读取，也不存在 `runtime_settings` fallback。

可信评论作者的认证依据是后台 session cookie，而不是邮箱本身。公开评论接口在检测到有效后台会话时，会使用当前站点配置的 `displayName`、`email`、`website` 创建已验证评论，并按 `badgeLabel` 展示标识；普通访客即使填写相同邮箱，也不会获得该标识，并会被拒绝使用已保留的可信作者邮箱。

IP 库路径、下载源、缓存策略和自动更新属于全局运维配置，由系统设置维护；站点设置不再重复提供这些字段。

## DB-Owned System Settings

系统设置保存在 `system_settings`。当前由 DB 长期拥有：

- `admin.session.ttlMinutes`
- `logging.level`
- `logging.retentionDays`
- `mail.enabled`
- `mail.smtp.host`
- `mail.smtp.port`
- `mail.smtp.secure`
- `mail.smtp.username`
- `mail.smtp.password`
- `mail.smtp.from`
- `captcha.provider`
- `captcha.image.*`
- `captcha.turnstile.*`
- `captcha.hcaptcha.*`
- `captcha.recaptcha.*`
- `captcha.geetest.*`
- `ipRegion.enabled`
- `ipRegion.cachePolicy`
- `ipRegion.precision`
- `ipRegion.autoUpdate.*`
- `ipRegion.ipv4.dbPath`
- `ipRegion.ipv4.sources`
- `ipRegion.ipv6.dbPath`
- `ipRegion.ipv6.sources`
- `avatar.gravatar.enabled`
- `avatar.gravatar.baseUrl`

首装会写入完整默认系统设置，其中后台会话有效期默认 `4320` 分钟（3 天）。若安装表单或 `QINGYAN_ADMIN_SESSION_TTL_MINUTES` 提供了会话有效期，会写入 `system_settings.admin.session.ttlMinutes`，正常运行后可继续在 Admin Console 修改。若存在 `QINGYAN_SMTP_PASSWORD` 或 `QINGYAN_TURNSTILE_SECRET_KEY`，安装器会把对应 secret 覆盖写入 `system_settings` 的 `mail.smtp.password` 或 `captcha.turnstile.secretKey`。安装计划和安装结果只显示来源与“已配置”，不返回明文。

Admin Console API 会返回 logging、mail、captcha、ipRegion 和 avatar 的 typed 设置。secret 字段不会在 Admin Console API、install plan/apply 或普通 export 中返回明文；响应只返回 `passwordConfigured`、`secretKeyConfigured`、`apiKeyConfigured` 或 `captchaKeyConfigured` 这类配置状态。更新 Admin system settings 时，如果请求省略 secret 字段，会保留数据库中已有 secret。

`${server.publicPath}/api/admin/*` 主要服务 QingYan 自带 Admin Console，不作为公开 API 或第三方前端集成合同维护；这些接口可以随内置后台一起调整，不建议第三方站点前端当作公开稳定合同直接依赖。公开 OpenAPI 只描述内容站点前端会直接调用的评论、验证码、页面反馈接口，以及 Web Upgrade Mode 最小接口；Admin Console Web API 单独维护在 `docs/admin-console-api.md`。

日志目录仍属于部署环境，不在后台修改。后台 cookie 名称、SameSite 和 Secure 仍属于启动配置；新登录会话 TTL、logging level/retention、公开评论 captcha provider 配置、IP region scheduler/updater 配置均从 `system_settings` 读取，不再把 startup YAML 作为长期 owner。

### Gravatar 作者头像 URL

`system_settings` 中的 `avatar.gravatar` 控制公开评论是否返回 Gravatar URL：

- `avatar.gravatar.enabled`：是否启用后端 Gravatar URL 生成，默认关闭。
- `avatar.gravatar.baseUrl`：Gravatar 头像 endpoint base URL，默认 `https://gravatar.com/avatar`，可替换为镜像地址。

启用后，公开评论作者结构可能包含 `author.gravatarUrl`。该字段只表示第三方 Gravatar 图片地址；QingYan 不托管、不上传、不代理、不缓存头像文件。字段名故意不使用 `avatarUrl`，避免误解为后端提供通用头像系统。没有该字段、Gravatar 图片 404 或图片加载失败时，前端应继续使用名称首字母或文字 fallback。

### 普通评论者资料记忆推荐集成

QingYan 不要求为普通访客建立用户模型。若内容站点希望避免访客重复输入昵称、邮箱和网站，推荐由站点前端在普通评论成功提交后，把评论者资料保存在当前站点浏览器存储中，并在下一次渲染评论表单时预填。

推荐实现：

- 存储位置：主站前端的 `localStorage`，而不是 QingYan 后端设置的可读 cookie。
- 作用范围：按 QingYan `siteKey` 隔离，例如 `qingyan:commenter-profile:v1:<siteKey>`。
- 保存字段：`nickname | email | website` 中当前 `commentForm.allow` 允许的字段。
- 过期时间：默认 90 天；每次普通评论成功后刷新过期时间。
- 表单行为：可以默认勾选“记住我”，允许访客取消；取消后应清除当前 `siteKey` 的本地资料。

选择前端本地存储是为了兼容 QingYan 的两种常见部署方式：当 QingYan 与主站同域时，cookie 和本地存储都能工作；当 QingYan 使用独立域名时，QingYan 域下的 cookie 不能被主站页面直接读取，跨站 credential cookie 还会受到 `SameSite=None; Secure`、CORS credentials 和浏览器隐私策略影响。普通评论者资料只用于表单预填，由主站前端保存更稳定。

该资料不是认证状态：它不会生成可信作者标识，不会绕过验证码、限流、黑名单、审核策略，也不会绕过可信评论作者邮箱保留规则。当前请求是否为可信评论作者仍只由有效后台 session cookie 与站点的 `comments.verifiedAuthor` 设置决定。

## 评论验证码与元数据

公开评论验证码仍按同一站点、同一页面、同一访客维度复用。配置来源从站点的 DB settings 读取：

- `never`: 不要求验证码。
- `always`: bootstrap 阶段直接返回 challenge。
- `threshold`: 写操作达到阈值后返回 `*_CAPTCHA_REQUIRED`，客户端再拉取 captcha state。

评论请求环境信息属于用户信息收集。站点应在评论区或隐私说明中声明：提交评论时，本站会记录必要的请求环境信息，包括 IP 地址和浏览器 User-Agent，用于反垃圾、滥用排查、IP 属地与设备类型展示。公开页面不会展示完整 IP 地址或完整 User-Agent。

## 导入导出与迁移

普通迁移推荐携带：

- startup config
- SQLite 数据库文件

需要跨实例复制站点时，使用 QingYan export/import。当前 export hard cut 到 `formatVersion: 2`，可包含：

- `site`
- `siteSettings`
- `systemSettings`（非 secret 字段）
- 页面、访客、评论、投票、页面点赞、黑名单数据

导入模式：

- `data_only`: 只导入页面、评论、访客等数据，不修改设置。
- `settings_only`: 只更新站点和站点设置，不导入评论数据。
- `full_site`: 同时导入站点、站点设置和数据。

普通 export 不包含 admin session、admin password、install token、进程环境变量、SQLite 文件路径或 server host/port。普通 QingYan export 默认也不包含 system settings secret rows，例如 SMTP password、Turnstile secret、hCaptcha secret、reCAPTCHA API key 和 GeeTest captcha key。需要迁移 secret 时，应使用部署环境变量、重新在 Admin Console 输入，或等待未来 full backup/restore 模式。

普通 QingYan import 不接受 hand-crafted system settings secret rows；dry-run 阶段会直接拒绝。install restore 只接受普通 QingYan 站点级 export JSON，用于首装时恢复站点、评论、页面线程、访客和站点设置；它不能恢复 admin session、admin password、install token、进程环境变量、SQLite 路径、server host/port 或 secret 明文，也不能把普通 export 当作完整实例备份。

Admin 数据管理中的 WordPress WXR 导入和 QingYan JSON 导入在真实 apply 前会创建导入任务记录，并先生成一次数据库级备份。该备份用于保存合并前状态，和普通 QingYan export/import 的用途不同：

- 普通 export/import 面向跨实例业务迁移，格式会排除 session、install token、运行时路径和 secret 明文。
- 导入前数据库备份面向本实例回退，当前内置实现使用 SQLite backup API 生成主库备份，并在存在时记录 WAL/SHM 现场文件。
- 任务记录会保存备份的 `engine`、`strategy`、备份目录和文件 metadata，便于之后按运维流程停服务覆盖恢复。
- 当前内置数据库备份 provider 仅覆盖 SQLite。后续支持 PostgreSQL、MySQL 或 MariaDB 时，会通过独立 provider 或外部备份确认接入，不把普通业务 export 当作完整数据库备份。

## Future Upgrade Lifecycle

当前仓库尚无正式 release，所以本轮不提供旧配置、旧 `runtime_settings`、旧管理接口或旧 export v1 的兼容升级。第一次正式 release 后，破坏性配置或数据语义变化必须走 upgrade lifecycle；长期约束由 `AGENTS.project.md` 维护，开发过程设计 / 计划文档保存在仓库外 `E:\Project\Docs\Web\QingYan`。

启动时如果检测到 `upgrade_required`，QingYan 会进入 Web Upgrade Mode，而不是注册正常评论 API、Admin data API 或 Admin Console。服务端会输出 `${server.publicPath}/upgrade` 地址；浏览器访问该页面后，会通过 HttpOnly `qingyan_upgrade` cookie 完成一次性升级令牌校验。Web Upgrade Mode 只处理已有实例升级，和首次安装的 install mode 是不同生命周期，不能复用 `${server.publicPath}/admin/install` 语义。

Web Upgrade Mode 暴露最小接口：

- `GET /qingyan/upgrade`: 最小升级页面。
- `GET /qingyan/api/upgrade/state`: 返回公开脱敏的 UpgradePlan，或 recovery / broken config 状态。
- `POST /qingyan/api/upgrade/apply`: 需要升级 token 和精确确认文本 `UPGRADE QINGYAN`。

confirmed upgrade 的写入顺序固定为：重新检测状态、创建 partial marker、创建 SQLite 数据库备份和 startup config / UpgradePlan 备份、执行 schema migrations、执行 application upgrades、写入 `__qingyan_upgrades` ledger、成功后清理 partial marker。若备份失败，不写 upgrade ledger；若任一步失败，partial marker 会保留，下次启动进入 `recovery_required`，不会继续启动 normal app。

CLI 仍是底层运维入口：

```bash
pnpm qingyan:upgrade -- --dry-run --config config/qingyan.yml
pnpm qingyan:upgrade -- --apply --config config/qingyan.yml --backup-dir ./backup/upgrade
```

`--dry-run` 输出公开脱敏的 UpgradePlan，不写配置、SQLite 或 `__qingyan_upgrades`。`--apply` 仅用于 `upgrade_required` 状态，且必须提供 `--backup-dir`；CLI 和 Web Upgrade Mode 复用同一个升级执行服务。缺 startup config 仍进入 install mode，不进入 upgrade；坏 config 进入 `broken_config`，partial marker 进入 `recovery_required`。

### QingYanctl 运维入口

`qingyanctl` 与 `qyctl` 是等价入口。它们面向本机 Linux/Unix 运维，默认读取 QingYan 配置路径，也可通过 `--config` 或 `QINGYAN_CONFIG_PATH` 指定配置。Docker 镜像内会提供这两个 wrapper；非容器部署也可以直接使用构建产物中的 CLI。首次安装的 Web 切换流程不依赖这些外部 CLI，也不会通过 API 执行 shell 重启。

常用命令：

```bash
qyctl info
qyctl admin repass
qyctl admin entrance
qyctl export default ./site.json
qyctl import default ./site.json --dry-run
qyctl backup ./qingyan-full-backup
qyctl restore ./qingyan-full-backup.qingyan-backup --dry-run
qyctl upgrade --dry-run
qyctl update check
qyctl update plan
qyctl status
qyctl start
qyctl stop
qyctl restart
```

`qyctl upgrade` 只执行数据升级，不下载或替换程序文件。`qyctl update check` 只检测 `Virace/QingYan` published release，不停止服务、不覆盖程序；当前仓库尚未发布首个 Release 时会显示“尚未发布 Release”。程序更新由外部 shell / systemd action 编排；更新脚本应先用旧版本 `qyctl backup` 创建整站备份，再替换程序文件，随后调用新版本 `qyctl upgrade`。站点级 `export/import` 与整站 `backup/restore` 必须区分：前者是业务数据迁移，后者包含数据库完整备份、配置文件、安装锁和 manifest。

### Release 更新规则

- Release tag 使用 `vX.Y.Z` 或 `X.Y.Z`，并与 `package.json` version 对齐。
- 可自动更新的 release 需要提供 `qingyan-update-manifest.json`、`qingyan-vX.Y.Z-linux-x64.tar.gz` 和 `qingyan-vX.Y.Z-linux-x64.sha256`。
- Admin 运维页只做检测和提示，不直接执行程序覆盖。

## Dev Mode

`pnpm dev` 默认启用 dev mode，并提供固定开发管理员账号：

```text
username: admin
password: admin
captcha: 2468
```

可选环境变量：

```bash
QINGYAN_DEV_ADMIN_USERNAME=admin
QINGYAN_DEV_ADMIN_PASSWORD=admin
QINGYAN_DEV_CAPTCHA_ANSWER=2468
QINGYAN_DEV_ADMIN_TOKEN=dev-token
QINGYAN_DEV_ALLOWED_ORIGIN=http://localhost:4321
QINGYAN_DATABASE_MODE=none
```

行为说明：

- dev mode 使用显式 dev seed 创建单站点 `default`。
- dev seed 不从 startup config 的 `sites[]` 派生。
- DB-backed dev mode 会把 `default` site 和默认 `site_settings` 写入 SQLite。
- dev mode 会临时注入开发管理员账号，默认 `admin / admin`；安装时随机生成或用户设置的管理员用户名、密码不会用于本地 dev 登录。
- dev mode 保留已安装的后台入口，同时额外开放 `${server.publicPath}/admin/` 作为本地开发别名；非 dev 启动不会开放这个别名。
- `QINGYAN_DATABASE_MODE=none` 时不连接 SQLite，mock 状态只保存在当前进程内存中。
- 前端仍然必须显式传 `siteKey: "default"`。
- 生产环境不会暴露 `${server.publicPath}/api/dev/*`。

详细调用方式见 [docs/dev-mode-integration.md](dev-mode-integration.md)。

## 常用命令

```bash
pnpm config:check
pnpm config:check:local
pnpm db:generate
pnpm db:migrate
pnpm dev
pnpm dev:smoke
```
