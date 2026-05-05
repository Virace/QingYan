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
install.url=http://127.0.0.1:4401/admin/install
```

浏览器访问 `/admin/` 或 `/admin/install` 完成安装。安装 token 由 install page 通过 HttpOnly cookie 处理，不显示在 URL 或页面正文中；脚本化安装仍可显式提交 token。

安装接口会写入 startup config、初始化 SQLite、执行 migrations、写入 admin bootstrap、默认站点、默认 `site_settings` 和完整默认 `system_settings`。安装期间不启用管理员登录，默认后台入口 `/admin` 会跳转到安装页 `/admin/install`，正常 `/api/*` 接口不会注册；安装完成后重启服务进入正常模式，已安装状态下 `/admin/install` 返回 410。安装完成后的后台入口由安装时写入的 `admin.consolePath` 决定，可用于隐藏管理入口。

startup 环境变量会覆盖安装表单中对应字段，并在安装计划中标记来源。secret 环境变量只显示“已配置”；当前支持把 `QINGYAN_SMTP_PASSWORD` 与 `QINGYAN_TURNSTILE_SECRET_KEY` 作为首装 seed 写入 `system_settings`，响应中不会返回明文。如果目标 startup config 已存在但无效，安装器会在替换前创建同目录 `.bak-YYYYMMDDHHmmss` 备份。

安装相关环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `QINGYAN_CONFIG_PATH` | startup config 路径，默认 `config/qingyan.yml` |
| `QINGYAN_INSTALL_TOKEN` | 指定安装 token；不指定时启动时随机生成 |
| `QINGYAN_INSTALL_DISABLED=true` | 缺配置或坏配置时直接失败，不开放 install app |
| `QINGYAN_SERVER_HOST` | install app 监听 host |
| `QINGYAN_SERVER_PORT` | install app 监听 port |

## Startup Config

最小 startup config 形态如下，示例文件见 `config/qingyan.example.yml`：

```yaml
server:
  host: 0.0.0.0
  port: 4401
  publicBaseUrl: http://localhost:4401
  trustProxy: false

database:
  client: sqlite
  sqlite:
    file: ./data/qingyan.db

admin:
  session:
    cookieName: qingyan_admin
    ttlMinutes: 1440
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
- `publicBaseUrl`: 对外公开基础地址，应与实际网关或反代入口一致。
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
| `server.trustProxy` | `QINGYAN_TRUST_PROXY` | 是否信任反向代理 |
| `database.sqlite.file` | `QINGYAN_SQLITE_FILE` | SQLite 文件路径 |
| `admin.session.cookieName` | `QINGYAN_ADMIN_SESSION_COOKIE_NAME` | 后台会话 cookie 名 |
| `admin.session.ttlMinutes` | `QINGYAN_ADMIN_SESSION_TTL_MINUTES` | 后台会话有效期，单位分钟 |
| `admin.session.sameSite` | `QINGYAN_ADMIN_SESSION_SAME_SITE` | `strict | lax | none` |
| `admin.session.secure` | `QINGYAN_ADMIN_SESSION_SECURE` | 是否仅通过 HTTPS 发送后台 cookie |
| `mail.smtp.password` | `QINGYAN_SMTP_PASSWORD` | 首装时写入 `system_settings`，响应脱敏 |
| `captcha.turnstile.secretKey` | `QINGYAN_TURNSTILE_SECRET_KEY` | 首装时写入 `system_settings`，响应脱敏 |

环境变量管理的字段在 install 或后续配置查看中应作为 env source 展示。secret 类型字段只显示“已配置”，不展示明文。

## DB-Owned Site Settings

每个站点由数据库 `sites` 表持久化：

- `siteKey`
- `name`
- `allowedOrigins`

每个站点的行为由 `site_settings` 持久化，后台 API 路径为：

```text
GET /api/admin/sites/{siteKey}/settings
PUT /api/admin/sites/{siteKey}/settings
PATCH /api/admin/sites/{siteKey}
```

站点设置包含：

- 评论开关、默认审核状态、最大嵌套深度、分页上限。
- 评论身份字段：`nickname | email | website` 的允许和必填状态。
- 验证码模式：`never | always | threshold` 及阈值窗口。
- 滥用保护和自动黑名单策略。
- 评论请求元数据采集：IP、User-Agent、IP 属地、设备解析。
- 页面点赞开关。
- 邮件通知开关。

这些字段不再从 YAML 读取，也不存在 `runtime_settings` fallback。

## DB-Owned System Settings

系统设置保存在 `system_settings`。当前由 DB 长期拥有：

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

首装会写入完整默认系统设置。若存在 `QINGYAN_SMTP_PASSWORD` 或 `QINGYAN_TURNSTILE_SECRET_KEY`，安装器会把对应 secret 覆盖写入 `system_settings` 的 `mail.smtp.password` 或 `captcha.turnstile.secretKey`。安装计划和安装结果只显示来源与“已配置”，不返回明文。

Admin API 会返回 logging、mail、captcha 和 ipRegion 的 typed 设置。secret 字段不会在 Admin API、install plan/apply 或普通 export 中返回明文；响应只返回 `passwordConfigured`、`secretKeyConfigured`、`apiKeyConfigured` 或 `captchaKeyConfigured` 这类配置状态。更新 Admin system settings 时，如果请求省略 secret 字段，会保留数据库中已有 secret。

日志目录仍属于部署环境，不在后台修改。logging level/retention、公开评论 captcha provider 配置、IP region scheduler/updater 配置均从 `system_settings` 读取，不再把 startup YAML 作为长期 owner。

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

普通 QingYan import 不接受 hand-crafted system settings secret rows；dry-run 阶段会直接拒绝。当前 install restore mode 仍未实现，不能把普通 export 当作完整实例备份。

## Future Upgrade Lifecycle

当前仓库尚无正式 release，所以本轮不提供旧配置、旧 `runtime_settings`、旧管理接口或旧 export v1 的兼容升级。第一次正式 release 后，破坏性配置或数据语义变化必须走 upgrade lifecycle；预留规则见 [upgrade-lifecycle.md](upgrade-lifecycle.md)。

当前已预留 CLI 骨架：

```bash
pnpm qingyan:upgrade -- --dry-run --config config/qingyan.yml
pnpm qingyan:upgrade -- --apply --config config/qingyan.yml --backup-dir ./backup/upgrade
```

`--dry-run` 输出公开脱敏的 UpgradePlan，不写配置、SQLite 或 `__qingyan_upgrades`。`--apply` 仅用于 `upgrade_required` 状态，且必须提供 `--backup-dir`；写入 upgrade ledger 前会备份 startup config、SQLite DB、WAL/SHM 和 UpgradePlan。缺 startup config 仍进入 install mode，不进入 upgrade；坏 config 进入 `broken_config`，partial marker 进入 `recovery_required`。

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
- `QINGYAN_DATABASE_MODE=none` 时不连接 SQLite，mock 状态只保存在当前进程内存中。
- 前端仍然必须显式传 `siteKey: "default"`。
- 生产环境不会暴露 `/api/dev/*`。

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
