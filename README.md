# 清言

<p align="center" style="background-color:#fff">
  <img src="docs/branding/qingyan-logo-lockup.png" alt="清言（QingYan）品牌图" width="560" />
</p>

![Node 24](https://img.shields.io/badge/node-%3E%3D24-43853d?logo=node.js&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/typescript-6-3178c6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/fastify-5-000000?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-3-003b57?logo=sqlite&logoColor=white)
![OpenAPI](https://img.shields.io/badge/openapi-3.1-6ba539?logo=openapiinitiative&logoColor=white)

清言（QingYan）是一个很干净、API-first 的评论与对话基础设施。当前基线聚焦后端接口与后台管理能力，可服务于 FangYuan 等内容站点的评论、验证码、页面点赞和管理需求。

它不是论坛系统、评论 SaaS，也不是强调自有前端体验的完整评论产品。当前仓库提供的是一个可自部署、可继续演进、低噪声的评论后端基线。

QingYan 与 FangYuan 通过公开 HTTP API 契约解耦：FangYuan 只是当前一个已接入的前端，不要求和 QingYan 同步发布，也不依赖 QingYan 仓库内的实现细节或发布节奏。

## 当前能力

- 评论首屏 bootstrap：`GET /api/comments/bootstrap`
- 评论线程分页：`GET /api/comments/thread`
- 评论创建、投票、验证码验证
- bootstrap 返回 `commentForm.allow / require`，前端可按 `nickname | email | website` 动态渲染必填项
- 页面点赞
- 后台登录（管理员登录验证码 + 5 次失败永久封禁 IP）
- 后台评论审核、黑名单、页面管理、用户管理、访客管理、站点总览、站点设置、系统设置
- 本地 `logs/access` 与 `logs/app` 双通道日志
- 文本 `.log` + 结构化 `.jsonl` 双格式落盘
- 后台可动态调整日志等级和保留天数
- 浏览器后台入口：`GET /admin`
- SQLite + Drizzle migration 基线
- Docker / Compose 本地或单机部署

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 首次安装

首次部署推荐让 QingYan 进入 install mode，而不是手写完整业务配置。

```bash
pnpm dev:api
```

当 `config/qingyan.yml` 不存在时，后端会启动 minimal install app，并在终端输出一次性安装地址：

```text
install.url=http://127.0.0.1:4401/admin/install
```

浏览器访问 `/admin/` 或 `/admin/install` 完成安装。安装 token 由 install page 通过 HttpOnly cookie 处理，不显示在 URL 或页面正文中。

安装流程会生成 startup config、初始化 SQLite、写入管理员 bootstrap、默认站点、站点设置和完整默认系统设置。安装完成后重启服务进入正常模式；已安装状态下 `/admin/install` 不再开放。安装期间不启用管理员登录，`/admin` 会跳转到安装页，正常 `/api/*` 接口不会注册；安装完成后的后台入口由安装时写入的 `admin.consolePath` 决定。

需要指定配置路径或安装 token 时可使用：

```bash
QINGYAN_CONFIG_PATH=./config/qingyan.yml QINGYAN_INSTALL_TOKEN=change-me pnpm dev:api
```

startup 环境变量会覆盖安装表单中对应字段，并在安装计划中标记来源。secret 环境变量只显示“已配置”；当前支持把 `QINGYAN_SMTP_PASSWORD` 与 `QINGYAN_TURNSTILE_SECRET_KEY` 作为首装 seed 写入 `system_settings`，响应、Admin system settings 和普通 QingYan export 都不会返回明文。

### 3. 校验配置

```bash
pnpm config:check
pnpm config:check:local
```

### 4. 生成 / 同步数据库基线

```bash
pnpm db:generate
pnpm db:migrate
```

### 5. 启动开发服务

```bash
pnpm dev
```

默认监听地址：

- API: `http://localhost:4401`
- Admin: `http://localhost:5173/admin`
- OpenAPI JSON: `http://localhost:4401/openapi.json`
- OpenAPI YAML: `http://localhost:4401/openapi.yaml`
- API Docs: `http://localhost:4401/docs`

`pnpm dev` 会同时启动后端 API 和 Admin Vite 开发服务。Admin 开发服务会按配置中的 `admin.console.path` 生成入口路径，并把 `/api/*` 代理到后端。只需要单独启动后端时使用 `pnpm dev:api`；只调试 Admin 前端时可使用 `pnpm admin:dev`。

`pnpm dev` 默认启用快速开发模式，Admin 登录固定为：

```text
username: admin
password: admin
captcha: 2468
```

需要临时覆盖时可设置：

```bash
QINGYAN_DEV_ADMIN_USERNAME=admin QINGYAN_DEV_ADMIN_PASSWORD=secret QINGYAN_DEV_CAPTCHA_ANSWER=1357 pnpm dev
```

后端启动完成后会在 shell 中输出：

```text
admin.console.url=...
admin.username=...
admin.password=...
```

在 `pnpm dev` 下，这里会输出当前开发账号和密码，方便直接登录。非 dev 启动时，管理员入口、用户名和密码 hash 来自数据库 bootstrap 状态；安装完成页会显示一次性初始密码。

## 配置文档

- 完整配置说明见 [docs/configuration.md](docs/configuration.md)
- startup config 示例见 `config/qingyan.example.yml`
- 本地实参默认使用 `config/qingyan.yml`
- 站点、站点设置、系统设置由数据库持久化，后台管理端维护
- 普通 QingYan export 不包含 SMTP / captcha secret，迁移 secret 需通过环境变量、Admin Console 重新输入，或等待未来 full backup/restore 模式
- release 后破坏性升级的预留规则见 [docs/upgrade-lifecycle.md](docs/upgrade-lifecycle.md)

## 升级预留入口

当前尚无正式 release，不为旧未发布状态提供兼容升级。首次正式 release 后，如果检测到需要 confirmed upgrade，优先使用 CLI 入口生成计划并备份：

```bash
pnpm qingyan:upgrade -- --dry-run --config config/qingyan.yml
pnpm qingyan:upgrade -- --apply --config config/qingyan.yml --backup-dir ./backup/upgrade
```

`--dry-run` 只输出脱敏后的 `UpgradePlan`，不写配置、SQLite 或 upgrade ledger。`--apply` 必须显式提供 `--backup-dir`，执行前会备份 startup config、SQLite DB、WAL/SHM 和公开脱敏的 UpgradePlan。

## OpenAPI

- 规格文件：[`docs/openapi.yaml`](docs/openapi.yaml)
- 运行时 YAML：`GET /openapi.yaml`
- 运行时 JSON：`GET /openapi.json`
- 文档页：`GET /docs`

## Docker / Compose

### Docker 构建

```bash
docker build -t qingyan:local .
```

### Compose 启动

```bash
docker compose up --build
```

默认 Compose 会：

- 暴露 `4401:4401`
- 挂载 `./config:/app/config`
- 挂载 `./data:/app/data`
- 使用 `/healthz` 做健康检查

## 数据库与 `drizzle/`

`drizzle/` 目录需要入仓库。

原因很简单：它不是缓存，而是当前数据库结构的 migration 基线。没有它，就无法稳定重建 SQLite schema，也无法保证不同环境使用的是同一版数据库结构。

常用命令：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

## 开发命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm dev:api
pnpm admin:dev
pnpm dev:smoke
```

`pnpm check` 会串行执行格式检查、lint、typecheck、测试、构建和示例配置校验。

## 本地 Dev Mode

需要快速联调验证码、评论 seed 或后台场景时，可使用：

```bash
pnpm dev
```

`pnpm dev` 会自动启用 dev mode，并提供固定开发管理员账号：

```text
username: admin
password: admin
```

可选环境变量：

```bash
QINGYAN_DEV_ADMIN_USERNAME=admin
QINGYAN_DEV_ADMIN_PASSWORD=admin
QINGYAN_DEV_CAPTCHA_ANSWER=2468
QINGYAN_DEV_ADMIN_TOKEN=dev-token
QINGYAN_DEV_ALLOWED_ORIGIN=http://localhost:4321
```

只启动后端且需要 dev mode 时：

```bash
QINGYAN_DEV_MODE=true pnpm dev:api
```

如果只需要运行内置 mock，不希望连接或初始化 SQLite，可使用无数据库模式：

```bash
QINGYAN_DATABASE_MODE=none QINGYAN_DEV_ADMIN_TOKEN=dev-token pnpm dev
```

无数据库模式会自动启用 dev mode，并使用进程内存状态提供完整 dev mock 控制面和前台业务 API；进程重启后 mock 状态会丢失。

dev mode 只新增 `/api/dev/*` 控制面；正常业务接口仍然是 `/api/*` 与 `/admin`。前端在 dev mode 下依然需要显式传 `siteKey: "default"`。

更详细的下游联调方式、场景调用顺序、错误处理与 UI 对接建议见 [docs/dev-mode-integration.md](docs/dev-mode-integration.md)。
