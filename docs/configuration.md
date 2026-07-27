# QingYan 配置说明

QingYan 从首个正式版本 `v0.1.0` 起使用当前配置模型：配置文件只负责进程启动前必须知道的部署信息；站点、站点设置、系统设置和后台 bootstrap 状态由数据库持久化。首次部署推荐走 install-first 流程，而不是手写完整业务 YAML。

## 配置所有权

QingYan 把配置来源分成四类：

- `startup config`：YAML 文件，包含 server、database、admin session 和基础 security 字段。修改后通常需要重启。
- `env override`：白名单环境变量覆盖 startup config 或 install 行为。环境变量优先级高于 YAML。
- `db site settings`：数据库中的站点记录与 `site_settings`，包含评论开关、审核默认状态、验证码模式、评论身份字段、页面点赞、评论者回复邮件通知、后台用户通知、评论元数据采集等。
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

旧变量 `QINGYAN_INSTALL_RESTART_MODE` 已在 `v0.1.0` 前移除。安装切换模式只使用 `QINGYAN_INSTALL_TRANSITION_MODE`。Web 安装接口不会调用 `qyctl`、`systemctl` 或任意外部 shell 命令；Docker Compose 可用 `exit_for_supervisor` 交给 restart policy 拉起，直接部署或托管运行时通常使用默认的 `reload_in_process`。

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
  adminOriginGuard:
    enabled: true
    allowMissingOrigin: false
    allowedOrigins: []
  rateLimit:
    adminLogin:
      windowSec: 600
      maxFailures: 5
      autoBlacklistSec: 1800
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
- `adminOriginGuard`: 后台写接口的浏览器来源保护。
- `rateLimit`: 评论、投票、验证码和页面点赞限流参数。

`publicOriginGuard` 使用请求体或查询参数中的 `siteKey` 查找数据库站点 `allowedOrigins`。`Origin` / CORS 是浏览器侧来源门禁，不是 API 密钥；公开写接口仍然需要验证码、限流、黑名单和审核策略承受直接调用。

`adminOriginGuard` 使用 `system_settings.security.adminOriginGuard.allowedOrigins` 与当前请求的 `Origin` 校验后台写操作。默认启用且不允许缺失 `Origin`；同域部署通常不需要额外配置，跨域后台入口需要在 Admin Console 系统设置中加入精确 origin。

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

Admin Console 中的站点设置和系统设置按 owner 分离：站点级开关只影响当前站点，系统级 mail/captcha/avatar/publicApi/antiSpam 设置影响整个 QingYan 实例。

站点设置包含：

- 评论开关、默认审核状态、最大嵌套深度、分页上限。
- 评论身份字段：`nickname | email | website` 的允许和必填状态。
- 评论公开输入长度上限：作者名、作者网站、页面标题、页面 key 和评论正文。默认值分别为 `40`、`2048`、`200`、`512`、`2000`；后端硬上限分别为 `100`、`4096`、`500`、`1024`、`10000`。
- 可信评论作者：`comments.verifiedAuthor.enabled`、`displayName`、`email`、`website`、`badgeLabel`，用于管理员或楼主这类已验证来源回复。
- 站点人员显示名策略：`comments.staffDisplay.nameMode`，可选 `current_profile` 或 `snapshot`。默认 `current_profile`，即已验证评论公开展示时跟随当前可信作者资料；`snapshot` 会展示评论写入或导入时保存的作者名称。
- 验证码模式：`never | always | threshold` 及阈值窗口。
- 滥用保护和自动黑名单策略：`comments.abuseGuard.enabled` 控制 QingYan 应用层公开写入滥用计数，`comments.abuseGuard.autoBlacklist.enabled` 只控制是否自动创建黑名单规则。
- 评论请求元数据采集：IP、User-Agent、是否启用 IP 属地、属地显示精度、设备解析。
- 页面点赞开关。
- 页面来源注册设置：`pageRegistry.mode`、权威 sitemap URL 列表、未知页面响应、健康宽限时间和紧急锁定。
- 评论者回复邮件通知开关、公开评论框“回复提醒”默认勾选状态和后台用户通知开关。

这些字段不再从 YAML 读取，也不存在 `runtime_settings` fallback。

`comments.inputLimits` 会随公开评论 bootstrap 返回到 `data.comments.form.limits`，内容站点前端可用它约束表单长度；服务端仍以数据库中的当前站点设置为准。超过当前站点上限的评论创建、页面点赞等公开写入口会返回字段级 `VALIDATION_FAILED`。硬上限用于防止后台误配置过大的输入，不表示建议前端展示到最大值。

`comments.abuseGuard.enabled=false` 表示关闭 QingYan 应用层的公开写入滥用计数和自动封禁触发；此时部署前方应有 WAF、反向代理、CDN、API 网关或等价基础设施限流。`comments.abuseGuard.autoBlacklist.enabled=false` 只关闭自动创建黑名单规则，不影响手动黑名单、验证码策略、基础限流、页面状态、功能开关或输入长度校验。滥用保护的写入计数覆盖评论创建、评论投票和页面点赞等公开写动作。

黑名单规则可由后台人工创建，也可由自动黑名单策略创建。解除某个 IP / email / visitor 的封禁应在 Admin Console 删除对应黑名单规则；删除后只解除该规则带来的拒绝，后续请求仍会继续经过页面状态、功能开关、输入长度、验证码、基础限流和滥用保护检查。

白名单规则独立于黑名单规则，支持 IP `exact | cidr`、email `exact | domain`、visitor `exact`。匹配白名单时，QingYan 会跳过对应黑名单拦截，并且不会把该请求计入自动黑名单触发；白名单优先级只服务于黑名单/自动黑名单。白名单不会绕过后台认证、CSRF、页面注册状态、页面交互状态、功能开关、必填字段、输入长度、验证码或基础限流。站点管理员只能管理自己有访问权的站点白名单，站点评论管理员默认不能管理白名单；全局规则只应由系统管理员维护。

页面来源注册设置是站点级 DB setting，不属于 startup YAML。公开运行时页面身份由允许 `Referer` 的 URL pathname 派生：保留前导 `/`、尾 `/`、大小写和重复斜杠，丢弃 query/hash；请求参数中的 `pageKey` / `pageUrl` 只作为 dev/mock 兼容字段。`discovery` 模式下未知页面会继续写入 pending candidate / pending PV 供后台审核；`authoritative` 模式下未知页面默认返回 inactive payload，不创建 visitor、pending、PV、captcha、thread、评论、投票或页面反馈记录。若 `unknownPageResponse=forbidden` 或 `emergencyLockdown=true`，未知页面返回 `PAGE_NOT_REGISTERED`。

开启 `authoritative` 必须配置至少一个 HTTP/HTTPS 权威 sitemap URL，且 URL origin 必须属于当前站点允许 origin。保存后系统会在任务中心幂等维护一个系统托管受保护的 `page_source_refresh` 任务，`systemKey` 为 `page_registry:authoritative_source_refresh:<siteKey>`，payload 中的 `sitemapUrls` 与 `pageRegistry.authoritativeSitemapUrls` 保持一致。当前版本不再保留 legacy source/sourceIds 刷新路径或迁移回填逻辑。

可信评论作者的认证依据是后台 session cookie，而不是邮箱本身。公开评论接口在检测到有效后台会话时，会使用当前站点配置的 `displayName`、`email`、`website` 创建已验证评论，并按 `badgeLabel` 展示标识；普通访客即使填写相同邮箱，也不会获得该标识，并会被拒绝使用已保留的可信作者邮箱。邮箱比较会按 trim + lower-case 归一化处理，后台评论者聚合、黑名单邮箱目标和可信作者邮箱保留规则都不区分大小写；原始大小写只作为显示或审计信息保留。

已验证评论会同时保留评论行上的作者快照和当前站点人员资料。`comments.staffDisplay.nameMode=current_profile` 时，公开评论树对已验证评论展示当前 `comments.verifiedAuthor.displayName`；`snapshot` 时展示评论行保存的 `authorName`。普通访客评论始终展示评论行保存的名称，不会跟随任何邮箱资料。

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
- `notifications.delivery.*`
- `notifications.channelConfigs[]`
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
- `avatar.external.enabled`
- `avatar.external.baseUrl`
- `avatar.external.hashAlgorithm`
- `avatar.external.query`
- `avatar.display.shape`
- `avatar.display.sizePx`
- `publicApi.advisoryFields.enabled`

首装会写入完整默认系统设置，其中后台会话有效期默认 `4320` 分钟（3 天）。若安装表单或 `QINGYAN_ADMIN_SESSION_TTL_MINUTES` 提供了会话有效期，会写入 `system_settings.admin.session.ttlMinutes`，正常运行后可继续在 Admin Console 修改。若存在 `QINGYAN_SMTP_PASSWORD` 或 `QINGYAN_TURNSTILE_SECRET_KEY`，安装器会把对应 secret 覆盖写入 `system_settings` 的 `mail.smtp.password` 或 `captcha.turnstile.secretKey`。安装计划和安装结果只显示来源与“已配置”，不返回明文。

Admin Console API 会返回 logging、mail、notifications、captcha、ipRegion、avatar 和 publicApi 的 typed 设置。secret 字段不会在 Admin Console API、install plan/apply 或普通 export 中返回明文；响应只返回 `passwordConfigured`、`secretConfigured`、`appTokenConfigured`、`secretKeyConfigured`、`apiKeyConfigured` 或 `captchaKeyConfigured` 这类配置状态。更新 Admin system settings 时，如果请求省略 secret 字段，会保留数据库中已有 secret。

`${server.publicPath}/api/admin/*` 主要服务 QingYan 自带 Admin Console，不作为公开 API 或第三方前端集成合同维护；这些接口可以随内置后台一起调整，不建议第三方站点前端当作公开稳定合同直接依赖。公开 OpenAPI 只描述内容站点前端会直接调用的评论、验证码、页面反馈接口，以及 Web Upgrade Mode 最小接口；Admin Console Web API 单独维护在 `docs/admin-console-api.md`。

日志目录仍属于部署环境，不在后台修改。后台 cookie 名称、SameSite 和 Secure 仍属于启动配置；新登录会话 TTL、logging level/retention、公开评论 captcha provider 配置、IP region scheduler/updater 配置均从 `system_settings` 读取，不再把 startup YAML 作为长期 owner。

### 通知与任务队列

评论通知配置分为站点级和系统级：

- 系统级 `system_settings.mail.enabled` 与 `mail.smtp.*` 控制整个实例是否具备邮件发送能力。SMTP 未完整配置时，无论站点级开关如何设置，email 都不能投递。
- 站点级 `site_settings.commenter_reply_email_enabled` 对应 Admin API `notifications.commenter.replyEmailEnabled`，只控制普通评论者是否可订阅已审核回复邮件。它会参与公开 bootstrap 的 `features.replyEmailNotification.enabled` 计算，不影响后台用户通知。
- 站点级 `site_settings.commenter_reply_email_default_checked` 对应 Admin API `notifications.commenter.replyEmailDefaultChecked`，只控制公开评论框首次显示时的初始勾选状态。能力不可用时 bootstrap 固定返回 `defaultChecked=false`；评论创建仍必须显式提交 `options.notifyOnReply=true`，不能把默认勾选当作服务端订阅。
- 站点级 `site_settings.backend_notifications_enabled` 对应 Admin API `notifications.backend.enabled`，只控制是否为后台用户创建站点通知任务，不影响普通评论者回复邮件订阅。
- 站点级 `site_notification_recipients` 对应 Admin API `notifications.backend.recipients`，引用后台用户 `admin_users.id`，用于维护后台用户接收人、内容策略和启用状态；具体事件和接收渠道由 `site_notification_recipient_routes` 绑定。
- 系统级 `system_settings.notifications.delivery.*` 控制全局通知限速、低优先级延迟和队列后端。
- 系统级 `notification_channel_configs` 维护具体通知渠道配置实例。`email:default` 是只读默认邮件实例；Webhook 和 WxPusher 可配置多个实例，例如 `webhook:feishu`、`webhook:ops`、`wxpusher:audit`。站点接收人 route 使用 `channelConfigId` 选择具体实例。
- 通知模板由 `notification_templates` 保存自定义覆盖；没有覆盖时使用内置默认模板。

这三层必须独立排查：系统邮件/SMTP 是 email transport；评论者回复邮件是普通评论者 opt-in
链路；后台用户通知是站点人员事件和 route 链路。开启其中一层不会自动开启另外两层。
Admin Console 的“通知”页会按已保存配置静态检查“待审核评论 → 站点人员”“直接发布评论
→ 站点人员”“站点人员回复 → 原评论者”三条 flow，并返回 blocker 的 canonical setting
path。未保存的页面草稿不会参与静态检测。

真实评论邮件测试不要求内容站点创建页面或提供前端。QingYan 会使用内置
`notification_test` 线程和正式 planner/queue/worker/template/email adapter，先创建评论 A
测试站点人员邮件，再模拟站点人员回复测试评论者邮件。真实测试只选择 email route，不发送
Webhook/WxPusher。测试的 `passed` / delivery `sent` 只表示邮件服务商接受请求，不证明进入
收件箱；最后仍需人工核对两个收件箱、垃圾邮件和退信。

队列默认后端是 `database`，会把任务写入 `task_runs` 并把投递写入 `notification_deliveries`，任务中心从这两个表展示通知任务状态。可选后端 `bullmq` 需要单独部署 Redis 并在运行环境中提供 Redis 连接配置；BullMQ 只负责队列传递，业务 planner、worker、delivery projection 和任务中心仍使用相同数据模型。未选择 BullMQ 时，Redis 不是必需依赖。

通知任务状态固定为 `queued`、`delayed`、`running`、`retrying`、`succeeded`、`failed`、`suppressed`、`cancelled`。通知接收人类型固定为 `backend_user`、`commenter`、`test`。普通评论者只支持 email；后台用户可使用 email、webhook、wxpusher，具体发送还要同时满足系统渠道配置实例、站点接收人 route 和个人偏好。任务和投递会记录 `channelConfigId` / `channelConfigName` 快照，用于区分多个同类型通道实例。

评论者回复通知的公开写入语义：

- `POST /api/comments` 的 `options.notifyOnReply` 只更新普通评论者在当前站点、当前邮箱的回复邮件偏好。
- 只有普通评论者邮箱通过通知邮箱策略时才创建偏好；明显占位或无效邮箱不会创建偏好，但评论创建继续成功。
- 只有最终 `approved` 的回复会触发普通评论者 email 任务；pending 回复在通过审核前不会发送。
- import、migration 和系统来源不会创建评论者通知任务，也不会创建历史评论者偏好。
- 全局退订链接使用一次性 token；数据库只保存 token hash，明文 token 只用于邮件链接生成，不写入任务 payload、日志、导出或 Admin API 响应。

后台用户通知语义：

- 接收人引用后台用户，不从 `comments.verifiedAuthor.email` 或评论作者邮箱派生长期接收人。
- 待审核评论创建 `admin_comment_pending`；直接通过审核的评论创建 `admin_comment_approved`；pending 评论后续通过审核不再追加第二条后台用户通知。
- 通知 planner、队列、worker、SMTP、Webhook 或 WxPusher 失败都不应阻断评论创建、审核、后台回复、导入、迁移或任务中心读取。

Webhook secret、WxPusher app token、SMTP password 和退订明文 token 均属于敏感信息。它们不会在 Admin API GET 响应、普通 export、任务 payload 或日志中以明文返回；更新时省略 secret 字段或提交空 `secretConfig` 表示保留已有值。Webhook URL 的 query string 也不会写入收件地址快照，避免把 query token 带入任务中心和日志。

### 外部头像 URL

`system_settings` 中的 `avatar.external` 控制公开评论是否返回外部头像 URL：

- `avatar.external.enabled`：是否启用后端外部头像 URL 生成，默认关闭。
- `avatar.external.baseUrl`：头像服务 endpoint base URL，默认 `https://gravatar.com/avatar`。生成时会在末尾追加邮箱 hash。
- `avatar.external.hashAlgorithm`：邮箱哈希算法，可选 `sha256` 或 `md5`，默认 `sha256`。
- `avatar.external.query`：头像 URL 查询参数，不包含开头的 `?`，多个参数用 `&` 分隔，默认 `s=80&d=404&r=g`。
- `avatar.display.shape`：给前端评论组件的头像形状建议，可选 `circle`、`rounded`、`square`，默认 `circle`。
- `avatar.display.sizePx`：给前端评论组件的头像显示尺寸建议，范围 16 到 256，默认 `40`。
- `publicApi.advisoryFields.enabled`：是否在公开 API 中返回展示建议字段，默认关闭。

启用后，公开评论作者结构可能包含 `author.avatarUrl`。该字段只表示第三方头像图片地址；QingYan 不托管、不上传、不代理、不缓存头像文件，也不保证远端头像文件一定存在。没有该字段、外部头像图片 404 或图片加载失败时，前端应继续使用名称首字母或文字 fallback。使用 `d=404` 时，前端需要接受一次图片请求返回 404；QingYan 不会额外代理或探测头像是否存在。

公开评论 bootstrap 响应会在 `data.comments.display.avatar.external.enabled` 返回当前是否可能输出 `author.avatarUrl`；thread 响应使用 `display.avatar.external.enabled`。默认不返回头像形状、显示尺寸这类前端展示建议；只有 `publicApi.advisoryFields.enabled=true` 时才会额外返回 `data.comments.display.avatar.display.shape` / `display.avatar.display.shape` 和对应 `sizePx`。头像请求尺寸仍由 `avatar.external.query` 自行决定，前端展示尺寸由前端自己的布局决定；后端建议字段只用于需要后端集中下发展示建议的集成场景。

常见配置示例：

- Gravatar：`baseUrl=https://gravatar.com/avatar`，`hashAlgorithm=sha256`，`query=s=80&d=404&r=g`。参考 [Gravatar image requests](https://docs.gravatar.com/sdk/images/)。
- Cravatar：`baseUrl=https://cravatar.cn/avatar`，`hashAlgorithm=md5`，`query=s=160&d=identicon`。参考 [Cravatar API](https://cravatar.com/developer/api)。
- WeAvatar：`baseUrl=https://weavatar.com/avatar`，按官方文档选择参数，例如 `d=initials&name=Alice` 或 `d=color`。参考 [WeAvatar 文档](https://weavatar.com/doc)。

当前没有运行时代码兼容旧 `avatar.gravatar.*`。历史测试实例如需迁移 SQLite 中已有设置，可先备份数据库，再执行类似 SQL：

```sql
UPDATE system_settings SET key = 'external.enabled' WHERE category = 'avatar' AND key = 'gravatar.enabled';
UPDATE system_settings SET key = 'external.baseUrl' WHERE category = 'avatar' AND key = 'gravatar.baseUrl';
DELETE FROM system_settings WHERE category = 'avatar' AND key IN ('gravatar.size', 'gravatar.defaultImage', 'gravatar.rating', 'gravatar.forceDefault');
INSERT INTO system_settings (category, key, value_json)
SELECT 'avatar', 'external.hashAlgorithm', '"sha256"'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'avatar' AND key = 'external.hashAlgorithm');
INSERT INTO system_settings (category, key, value_json)
SELECT 'avatar', 'external.query', '"s=80&d=404&r=g"'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'avatar' AND key = 'external.query');
```

### 普通评论者资料记忆推荐集成

QingYan 不要求为普通访客建立用户模型。若内容站点希望避免访客重复输入昵称、邮箱和网站，推荐由站点前端在普通评论成功提交后，把评论者资料保存在当前站点浏览器存储中，并在下一次渲染评论表单时预填。

推荐实现：

- 存储位置：主站前端的 `localStorage`，而不是 QingYan 后端设置的可读 cookie。
- 作用范围：按 QingYan `siteKey` 隔离，例如 `qingyan:commenter-profile:v1:<siteKey>`。
- 保存字段：`nickname | email | website` 中当前 `data.comments.form.allow` 允许的字段。
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

WordPress WXR 导入会读取 `wp:author` 和每条评论的 `wp:comment_user_id`。`comment_user_id` 非 0 且能匹配 WXR 作者 ID 时，会作为站点人员强匹配导入为 `author_identity=verified`；`comment_user_id=0` 但评论邮箱与 WXR 作者邮箱归一化后相同，只能作为邮箱候选，必须在 Admin Console 中确认“作为站点人员”或“保留访客”后才能生成导入计划。WXR 作者列表来自导出文件中的文章作者信息，不等同于完整 WordPress 用户表，因此多用户迁移后续仍需要单独设计。

WordPress `comment_content` 当前按纯文本导入和渲染：即使原始内容包含 `<a>` 等 HTML-like 片段，QingYan 也会按文本转义输出。导入分析报告会统计疑似 HTML 评论数量，方便管理员后续人工检查；有限 HTML 白名单或 sanitizer 不在当前迁移默认行为中。

## Upgrade Lifecycle

`v0.1.0` 是当前 upgrade lifecycle 的首个正式基线。后续破坏性配置、settings owner、secret 存储位置、数据语义、schema 或导入导出格式变化必须走 upgrade lifecycle；长期约束由 `AGENTS.md` 维护，开发过程设计 / 计划文档按全局 Agent 规则保存在仓库外。

启动时如果检测到 `upgrade_required`，QingYan 会进入 Web Upgrade Mode，而不是注册正常评论 API、Admin data API 或 Admin Console。服务端会同时输出 `${server.publicPath}/upgrade` 地址、升级状态和一次性升级令牌；浏览器访问该页面后，操作员需要输入启动日志显示的升级令牌，页面会把令牌随 apply 请求提交；服务端不会通过公开升级页面下发令牌 cookie。Web Upgrade Mode 只处理已有实例升级，和首次安装的 install mode 是不同生命周期，不能复用 `${server.publicPath}/admin/install` 语义。

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
qyctl help
qyctl --version
qyctl info
qyctl admin repass
qyctl admin entrance
qyctl export default ./site.json
qyctl import default ./site.json --dry-run
qyctl backup ./qingyan-full-backup --yes
qyctl restore ./qingyan-full-backup.qingyan-backup --dry-run
qyctl upgrade --dry-run
qyctl update check
qyctl update plan
qyctl status
qyctl start
qyctl stop
qyctl restart
```

裸运行 `qyctl` 或 `qingyanctl` 会显示帮助信息。`qyctl status/start/stop/restart` 面向 systemd 直接部署；Docker Compose 部署应使用 `docker compose ps/restart/logs` 管理容器生命周期。

`qyctl upgrade` 只执行数据升级，不下载或替换程序文件。`qyctl update check` 只检测 `Virace/QingYan` published release，并同时输出当前版本和最新版本。Docker Compose 的实际更新统一运行 `./scripts/update.sh`；脚本负责预检、整站备份、Release 切换、镜像构建、UpgradePlan 确认、数据升级和健康验收。站点级 `export/import` 与整站 `backup/restore` 必须区分：前者是业务数据迁移，后者包含数据库完整备份、配置文件、安装锁和 manifest。

### Release 更新规则

- Release tag 使用 `vX.Y.Z` 或 `X.Y.Z`，并与 `package.json` version 对齐。
- 首个正式 release 为 `v0.1.0`。
- 当前正式 release 为 `v0.2.2`。
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
