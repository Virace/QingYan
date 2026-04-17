# QingYan 配置说明

`QingYan` 只使用 YAML 配置文件启动，运行时再叠加数据库中的 `runtime_settings` 做有限覆盖。

## 配置文件路径

- 默认读取：`config/qingyan.yml`
- 示例模板：`config/qingyan.example.yml`
- 可通过环境变量覆盖：

```bash
QINGYAN_CONFIG_PATH=./config/qingyan.yml
```

说明：

- `config/qingyan.example.yml` 应入仓库，用作示例和校验基线。
- `config/qingyan.yml` 默认被 `.gitignore` 排除，用于本地或服务器实参。
- 配置校验命令：

```bash
pnpm config:check
pnpm config:check:local
```

## 配置边界

### 只来自配置文件的字段

这些字段属于部署或敏感信息，不会被后台运行时设置覆盖：

- `server.*`
- `database.*`
- `admin.tokenHash`
- `admin.session.*`
- `security.requestIdHeader`
- `security.globalFloodGuard.*`
- `security.rateLimit.*`
- `captcha.*`
- `mail.*`
- `sites[].siteKey`
- `sites[].name`
- `sites[].allowedOrigins`

### 可被 `runtime_settings` 覆盖的字段

这些字段既有配置文件默认值，也有数据库运行时设置：

- `sites[].defaults.comments.enabled`
- `sites[].defaults.comments.defaultStatus`
- `sites[].defaults.comments.maxDepth`
- `sites[].defaults.comments.rootLimit`
- `sites[].defaults.comments.identity.*`
- `sites[].defaults.comments.allowWebsite`
- `sites[].defaults.comments.captcha.*`
- `sites[].defaults.comments.abuseGuard.*`
- `sites[].defaults.pageFeedback.allowLike`
- `sites[].defaults.notifications.emailEnabled`

启动时，配置文件先定义站点和默认值；运行时由数据库中的 `runtime_settings` 对上述字段做站点级覆盖。

## 顶层配置块

### `server`

```yaml
server:
  host: 0.0.0.0
  port: 4401
  publicBaseUrl: http://localhost:4401
  trustProxy: false
```

- `host`: Fastify 监听地址
- `port`: Fastify 监听端口
- `publicBaseUrl`: 对外公开基础地址，文档和部署入口应与实际网关一致
- `trustProxy`: 部署在反向代理后时设为 `true`

### `database`

```yaml
database:
  client: sqlite
  sqlite:
    file: ./data/qingyan.db
```

- 当前仅支持 `sqlite`
- `sqlite.file` 支持相对路径，解析基于仓库根目录 / 进程工作目录

### `admin`

```yaml
admin:
  tokenHash: "sha256:<hex>" # 或开发期明文
  session:
    cookieName: qingyan_admin
    ttlMinutes: 1440
    sameSite: lax
    secure: false
```

- `tokenHash`: 后台登录口令
  - 支持明文直接比较，主要用于本地开发
  - 支持 `sha256:<hex>` 格式，适合部署环境
- 后台登录每次都需要先完成管理员登录验证码
- 同一 IP 连续 5 次登录错误会被永久加入后台登录黑名单
- `session.cookieName`: 后台 cookie 名
- `session.ttlMinutes`: 会话有效期
- `session.sameSite`: `strict | lax | none`
- `session.secure`: HTTPS 环境建议设为 `true`

### `security`

```yaml
security:
  requestIdHeader: x-request-id
  globalFloodGuard:
    enabled: false
    windowSec: 10
    maxRequests: 120
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

- `requestIdHeader`: 外部请求链路传入 request id 时使用的 header 名
- `globalFloodGuard`: 进程级总请求洪峰保护
- `rateLimit.adminLogin`: 保留后台登录相关兼容配置结构；当前实现使用管理员登录验证码和 5 次失败永久封 IP 作为主保护逻辑
- `rateLimit.commentCreate`: 评论创建限流
- `rateLimit.commentVote`: 评论投票限流
- `rateLimit.captchaVerify`: 验证码验证失败限流
- `rateLimit.pageLike`: 页面点赞限流

说明：

- `maxRequests` 用于请求次数限流
- `maxFailures` 用于失败次数限流

### `captcha`

```yaml
captcha:
  provider: image
  image:
    width: 160
    height: 60
    ttlSec: 600
```

- 当前仅支持内置图片验证码
- 返回值中的 `challenge.imageData` 是 SVG data URL
- `ttlSec` 为 challenge 过期时间

### `mail`

```yaml
mail:
  enabled: false
  smtp:
    host: smtp.example.com
    port: 465
    secure: true
    username: notify@example.com
    password: "<secret>"
    from: notify@example.com
```

- 当前仓库保留邮件配置结构，但第一版基线不强制启用邮件发送
- `enabled: false` 时不会启用实际邮件能力

### `sites`

`sites` 是站点注册表。每个站点都必须声明自己的 `siteKey`、显示名、允许来源和默认能力。

```yaml
sites:
  - siteKey: fangyuan
    name: FangYuan
    allowedOrigins:
      - http://localhost:4321
    defaults:
      comments:
        enabled: true
        defaultStatus: pending
        maxDepth: 3
        rootLimit: 20
        identity:
          require:
            - nickname
            - email
        captcha:
          mode: threshold
          thresholdWindowSec: 60
          thresholdMaxActions: 3
        abuseGuard:
          enabled: true
          windowSec: 600
          maxWriteActions: 100
          autoBlacklist:
            enabled: true
            scope: post
            ttlSec: 1800
        allowWebsite: true
      pageFeedback:
        allowLike: true
      notifications:
        emailEnabled: false
```

字段说明：

- `siteKey`: API 请求使用的站点标识
- `name`: 后台展示名称
- `allowedOrigins`: 跨域允许来源
- `defaults.comments.enabled`: 是否默认启用评论
- `defaults.comments.defaultStatus`: 新评论默认状态，`pending` 或 `approved`
- `defaults.comments.maxDepth`: 评论最大嵌套深度
- `defaults.comments.rootLimit`: 首层评论分页上限默认值
- `defaults.comments.identity.require`: 评论身份字段必填集合
  - 当前允许 key：`nickname | email | website`
- `defaults.comments.captcha.mode`: `never | always | threshold`
- `defaults.comments.captcha.thresholdWindowSec`: 阈值验证码统计窗口
- `defaults.comments.captcha.thresholdMaxActions`: 从第 N 次写操作开始要求验证码
- `defaults.comments.abuseGuard.enabled`: 是否启用滥用保护
- `defaults.comments.abuseGuard.windowSec`: 滥用写入统计窗口
- `defaults.comments.abuseGuard.maxWriteActions`: 达到阈值后可进入自动黑名单逻辑
- `defaults.comments.abuseGuard.autoBlacklist.enabled`: 是否自动拉黑
- `defaults.comments.abuseGuard.autoBlacklist.scope`: `post | all`
- `defaults.comments.abuseGuard.autoBlacklist.ttlSec`: 自动黑名单有效期
- `defaults.comments.allowWebsite`: 是否允许评论作者提交个人网站
- `defaults.pageFeedback.allowLike`: 是否允许页面点赞
- `defaults.notifications.emailEnabled`: 是否启用邮件通知开关

## 本地配置建议

开发环境建议：

- `server.publicBaseUrl`: `http://localhost:4401`
- `admin.session.secure`: `false`
- `sites[].allowedOrigins`: 包含前端开发地址，例如 `http://localhost:4321`
- SQLite 文件放到 `./data/qingyan.db`

## 部署建议

- 使用 `config/qingyan.yml` 作为正式配置
- 通过容器卷或宿主机目录挂载 `config/` 与 `data/`
- 后台口令优先使用 `sha256:<hex>` 形式
- HTTPS 网关后将 `admin.session.secure` 设为 `true`
- 如部署在代理后，将 `server.trustProxy` 设为 `true`

## 常用命令

```bash
pnpm config:check
pnpm config:check:local
pnpm db:generate
pnpm db:migrate
pnpm dev
pnpm dev:smoke
```
