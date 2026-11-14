# 清言

<p align="center" style="background-color:#fff">
  <img src="docs/branding/qingyan-logo-lockup.png" alt="清言（QingYan）品牌图" width="560" />
</p>

![Node 24](https://img.shields.io/badge/node-%3E%3D24-43853d?logo=node.js&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/typescript-6-3178c6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL 18](https://img.shields.io/badge/postgresql-18-4169e1?logo=postgresql&logoColor=white)
![OpenAPI](https://img.shields.io/badge/openapi-3.1-6ba539?logo=openapiinitiative&logoColor=white)

清言（QingYan）是一个很干净、API-first 的评论与对话基础设施。当前基线聚焦后端接口与后台管理能力，可服务于 FangYuan 等内容站点的评论、验证码、页面点赞和管理需求。

它不是论坛系统、评论 SaaS，也不是强调自有前端体验的完整评论产品。当前仓库提供的是一个可自部署、可继续演进、低噪声的评论后端基线。

QingYan 与 FangYuan 通过公开 HTTP API 契约解耦：FangYuan 只是当前一个已接入的前端，不要求和 QingYan 同步发布，也不依赖 QingYan 仓库内的实现细节或发布节奏。

最近发布版本为 [`v0.2.5`](https://github.com/Virace/QingYan/releases/tag/v0.2.5)；当前开发版本使用 PostgreSQL 单一运行后端，旧 SQLite 实例需要离线转换，首个 upgrade lifecycle 基线为 `v0.1.0`。后续涉及 schema、配置语义、settings owner 或数据格式的破坏性变化必须进入 upgrade lifecycle。

## 当前能力

- 评论首屏 bootstrap：`GET /qingyan/api/comments/bootstrap`
- 评论线程分页：`GET /qingyan/api/comments/thread`
- 评论创建、投票、验证码验证
- bootstrap 返回 `features` 能力开关、回复提醒 `defaultChecked` 和 `data.comments.form.allow / require / limits`，前端可先按能力判断再动态渲染 `nickname | email | website` 必填项与输入长度
- 页面点赞
- 后台登录（管理员登录验证码 + 5 次失败永久封禁 IP）
- 后台评论审核、黑名单、白名单、页面管理、用户管理、访客管理、站点总览、站点设置、系统设置
- 后台通知页提供三条评论邮件静态诊断和 QingYan 内置双链路真实邮件测试
- 本地 `logs/access` 与 `logs/app` 双通道日志
- 文本 `.log` + 结构化 `.jsonl` 双格式落盘
- 后台可动态调整日志等级和保留天数
- 默认浏览器后台入口：`GET /qingyan/admin`
- PostgreSQL 18 + Drizzle / node-postgres，单一迁移账本
- Docker / Compose 本地或单机部署

## 快速开始

### Linux / Docker 脚本部署

已有 Docker、Compose 和 Git 的服务器可以直接运行 `scripts/install.sh`，由脚本获取稳定版本源码、构建镜像并启动容器：

```bash
bash scripts/install.sh --dir /opt/apps
```

`--dir` 是父目录，运行文件放在 `/opt/apps/qingyan/`，源码缓存默认放在 `/opt/apps/.qingyan-source/`；可用 `--source-dir` 单独指定源码位置。数据库使用预建的 PostgreSQL 18 专用库和账号。自动化运行可使用 `--non-interactive --database postgresql`；连接可在安装表单填写或通过受保护环境变量 `QINGYAN_DATABASE_URL` 注入。

安装脚本默认获取最高稳定 tag。`v0.2.5` 仍为 SQLite 源版本；当前 PostgreSQL 改造发布后，应显式固定对应的 PostgreSQL tag。已有 SQLite 实例先完成离线转换，再按已核对版本切换。

GitHub 拉取与构建依赖分别选源：

```bash
bash scripts/install.sh --dir /opt/apps --non-interactive \
  --github-source proxy --github-proxy https://gh-proxy.org \
  --network-profile cn
```

安装脚本不做备份、恢复或数据搬运。需要先放入原实例文件时，使用 `--prepare-only --version <原版本>`，文件放好后执行运行目录内的 `bash update.sh --start`。完成正常部署后，用该目录内的 `bash update.sh` 更新；源码缓存移除后，更新器会重新获取。

首次启动仍需在 `/qingyan/admin/install` 完成应用配置和初始化；安装令牌保存在运行目录 `.env` 的 `QINGYAN_INSTALL_TOKEN` 字段，脚本只提示文件位置。

脚本可独立下载执行，不要求本地已有仓库：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/develop/scripts/install.sh) --dir /opt/apps
```

脚本版本与应用版本独立：上面的入口获取 `develop` 中的安装脚本，应用源码仍默认选择最高稳定 tag，也可用 `--version` 指定。需要固定脚本内容时，将 URL 中的 `develop` 换成包含安装器的提交 SHA。更多代理入口、参数和目录说明见 [部署指南](docs/deployment.md#首次部署)。

### 1. 安装依赖

```bash
pnpm install
```

### 2. 首次安装

先准备 PostgreSQL 18 数据库与专用账号，使用 UTF8、UTC 与 C 比较规则。配置见 [配置说明](docs/configuration.md#database)，本地隔离测试库见 [开发验证](docs/deployment.md#本地开发与测试数据库)。生产不要使用测试账号。

首次部署推荐让 QingYan 进入 install mode，而不是手写完整业务配置。

```bash
pnpm dev:api
```

当 `config/qingyan.yml` 不存在时，后端会启动 minimal install app，并在终端输出一次性安装地址：

```text
install.url=http://127.0.0.1:4401/qingyan/admin/install
```

浏览器访问 `/qingyan/admin/` 或 `/qingyan/admin/install` 完成安装。安装 token 由 install page 通过 HttpOnly cookie 处理，不显示在 URL 或页面正文中。

安装流程会生成 startup config、初始化预建的空 PostgreSQL 数据库、写入管理员 bootstrap、默认站点、站点设置、完整默认系统设置，并在 startup config 同目录写入 `qingyan.installed.lock` 安装锁。安装完成后按 `QINGYAN_INSTALL_TRANSITION_MODE` 切换到正常服务；默认 `reload_in_process` 会在同一进程内启动正常服务，Docker Compose 可使用 `exit_for_supervisor` 退出后由 restart policy 拉起，受限运行时可使用 `manual` 提示人工重启。安装锁存在时不会启动 install app，正常后台中的 `${server.publicPath}${admin.consolePath}/install` 只返回已关闭提示，不作为后台 SPA 路由。安装期间不启用管理员登录，`/qingyan/admin` 会跳转到安装页，正常 `/qingyan/api/*` 接口不会注册；安装完成后的外部后台入口由 `server.publicPath + admin.consolePath` 决定。

需要指定配置路径或安装 token 时可使用：

```bash
QINGYAN_CONFIG_PATH=./config/qingyan.yml QINGYAN_INSTALL_TOKEN=change-me pnpm dev:api
```

安装完成切换方式可用 `QINGYAN_INSTALL_TRANSITION_MODE=reload_in_process|exit_for_supervisor|manual` 调整。Web 安装接口不会调用 `qyctl`、`systemctl` 或任意外部 shell 命令。

startup 环境变量会覆盖安装表单中对应字段，并在安装计划中标记来源。secret 环境变量只显示“已配置”；当前支持把 `QINGYAN_SMTP_PASSWORD` 与 `QINGYAN_TURNSTILE_SECRET_KEY` 作为首装 seed 写入 `system_settings`，响应和 Admin system settings 都不会返回明文。

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
- Admin: `http://localhost:5173/qingyan/admin`
- OpenAPI JSON: `http://localhost:4401/qingyan/openapi.json`
- OpenAPI YAML: `http://localhost:4401/qingyan/openapi.yaml`
- API Docs: `http://localhost:4401/qingyan/docs`

`pnpm dev` 会同时启动后端 API 和 Admin Vite 开发服务。Admin 开发服务会按已安装的后台入口生成主入口，并把 `/qingyan/api/*` 代理到后端。dev mode 下 `/qingyan/admin/` 始终作为额外开发入口可用；如果安装时生成或设置了其他后台路径，`/qingyan/admin/` 和该路径会同时可用，`/qingyan/admin/` 不会在非 dev 启动中开放为别名。只需要单独启动后端时使用 `pnpm dev:api`；只调试 Admin 前端时可使用 `pnpm dev:admin`。

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

## 运维 CLI

构建后会提供两个等价入口：

```bash
qingyanctl help
qyctl help
```

Docker 镜像内同样提供 `qyctl` 和 `qingyanctl`。它们用于运维、备份、恢复、升级和重置后台信息；首次安装完成后的 Web 切换不依赖 CLI 存在。

`qyctl info` 用于快速查看服务状态、控制台入口、管理员用户名、配置文件和脱敏数据库身份，不显示管理员密码。数据库只保存密码 hash；如需重置密码，使用：

```bash
qyctl admin repass
qyctl admin repass <password>
```

后台入口可通过以下命令重置；不传路径时自动生成随机入口：

```bash
qyctl admin entrance
qyctl admin entrance /hidden-admin
```

运行时已撤下后台 QingYan/WordPress 导入导出、站点导入导出 CLI 和全部定时备份。旧 SQLite 转换使用独立的 `pnpm db:convert`，详见 [离线转换与切换](docs/postgresql-conversion.md)。

整实例备份使用 PostgreSQL 自定义格式 dump，连同配置、安装锁、必要资源和 manifest 保存。先停写并等待在途任务结束，再执行：

```bash
qyctl backup ./qingyan-full-backup --yes --service-stopped
qyctl restore ./qingyan-full-backup.qingyan-backup --dry-run
qyctl restore ./qingyan-full-backup.qingyan-backup --yes --target-config ./restore-target.yml --output-config ./restored/qingyan.yml
```

恢复目标必须是运维预建的空数据库，目标配置含其连接参数。恢复后生成新配置，切换另行确认执行；原配置和原库保留。备份与恢复文件含密钥和用户内容，按私密数据保管。Docker 停写、恢复与升级步骤见 [部署指南](docs/deployment.md#备份与恢复)。

程序更新检测基于当前仓库的 GitHub Release：

```bash
qyctl update check
qyctl update plan
```

`update check` 只检测 `Virace/QingYan` published release，不修改程序。新脚本部署在运行目录执行 `bash update.sh`；已有源码部署继续在仓库根目录执行：

```bash
./scripts/update.sh
```

`v0.2.2` 之前的 checkout 尚无该脚本，可使用固定版本的远程入口完成首次更新：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/v0.2.5/scripts/update.sh)
```

脚本默认选择最高的稳定 release tag，依次执行预检、整站备份、镜像构建、UpgradePlan 确认、数据升级和健康验收；可显式传入目标 tag，并用 `--yes` 接受两次确认。生产侧修改过的 `compose.yml` 和未跟踪运维文件会被安全暂存并在新 tag 上恢复，其他已跟踪源码改动仍会阻止更新。

在 `pnpm dev` 下，这里会输出当前开发账号和密码，方便直接登录。即使安装时随机生成过管理员用户名和密码，dev mode 也会临时注入开发账号；非 dev 启动时，管理员入口、用户名和密码 hash 来自数据库 bootstrap 状态，安装完成页会显示一次性初始密码。

## 配置文档

- 完整配置说明见 [docs/configuration.md](docs/configuration.md)
- startup config 示例见 `config/qingyan.example.yml`
- 本地实参默认使用 `config/qingyan.yml`
- 站点、站点设置、系统设置由数据库持久化，后台管理端维护
- 首个正式版本 `v0.1.0` 已发布；公开输入由站点级上限约束，后续破坏性升级必须走 upgrade lifecycle
- 应用层滥用保护和自动黑名单可在 Admin Console 关闭；关闭时建议由 WAF、反向代理、CDN 或 API 网关承担更强限流与拦截
- 黑名单和白名单均在 Admin Console 的安全规则中管理；白名单只影响黑名单/自动黑名单优先级，不绕过页面状态、功能开关、验证码、基础限流或输入校验
- release 后破坏性升级规则由项目规范维护；开发过程设计和计划文档保存在项目外文档区

## 升级入口

从 `v0.1.0` 起，已有实例升级必须走明确的 upgrade lifecycle。如果启动时检测到 `upgrade_required`，QingYan 会进入 Web Upgrade Mode，而不是启动正常评论 API 或 Admin Console。终端会输出：

```text
upgrade.url=http://127.0.0.1:4401/qingyan/upgrade
upgrade.state=upgrade_required
upgrade.token=qy_upgrade_<一次性随机值>
```

浏览器访问 `/qingyan/upgrade` 可查看脱敏后的 `UpgradePlan`，输入同一段启动日志中的升级 token，并在确认备份路径和风险后输入 `UPGRADE QINGYAN` 执行升级。PostgreSQL 常规升级写入前会先停写并创建数据库 dump、startup config、必要资源和公开 UpgradePlan 备份；旧 SQLite 配置会提示先执行离线转换；失败时保留 partial marker，下次启动进入 `recovery_required`，不会继续启动正常服务。

CLI 仍是底层运维入口，适合服务器、Docker、CI 或 Web 无法启动的场景：

```bash
pnpm qingyan:upgrade -- --dry-run --config config/qingyan.yml
qyctl upgrade --yes --service-stopped --config config/qingyan.yml --backup-dir ./backup/upgrade
```

`--dry-run` 只输出脱敏后的 `UpgradePlan`，不写配置、数据库或 upgrade ledger。写入前必须停写，可通过 `--backup-dir` 指定备份目录，并与 Web Upgrade Mode 复用同一个升级执行服务。

## OpenAPI

- 规格文件：[`docs/openapi.yaml`](docs/openapi.yaml)
- 运行时 YAML：`GET /qingyan/openapi.yaml`
- 运行时 JSON：`GET /qingyan/openapi.json`
- 文档页：`GET /qingyan/docs`

公开 OpenAPI 只覆盖内容站点前端会直接调用的评论、验证码、页面反馈接口，以及 Web Upgrade Mode 最小接口。Admin Console Web 使用的 `/api/admin/*` 管理接口不进入公开 OpenAPI；开发者调试或扩展内置后台时可参考 [`docs/admin-console-api.md`](docs/admin-console-api.md)。

## 评论邮件排障

评论邮件不是一个总开关，至少有三层独立配置：系统邮件与 SMTP、普通评论者回复邮件、
后台用户通知与站点人员 route。只打开其中一层，不代表另外两条链路已经可发送。

在 Admin Console 的“站点设置 → 通知”中可以：

- 查看待审核评论、直接发布评论和评论回复三条 email flow 的 saved-config blocker；
- 设置公开评论框“回复提醒”是否默认勾选；
- 输入一个评论者邮箱，使用 QingYan 内置测试页走真实
  planner → queue → worker → template → email adapter 链路。

真实测试第一条线路把评论 A 发送给当前匹配的站点人员 email route，第二条线路模拟站点人员
回复并通知评论 A 的用户；不要求内容站点创建页面或提供前端。结果中的 `passed` / `sent`
表示邮件服务商接受了发送请求，不等于邮件已经进入收件箱，最终仍需核对两个收件箱、垃圾邮件
和服务商退信。

## Docker / Compose

### Docker 构建

```bash
docker build -t qingyan:local .
```

### Compose 启动

```bash
docker compose up --build
```

默认 Compose 连接外部或共享 PostgreSQL，设置受保护的 `QINGYAN_DATABASE_URL`；数据库服务、专用库与角色由运维预建。PostgreSQL 镜像固定版本及资源建议见部署指南。默认 Compose 会：

- 暴露 `4401:4401`
- 挂载 `./config:/app/config`
- 挂载 `./data:/app/data`
- 设置 `QINGYAN_INSTALL_TRANSITION_MODE=exit_for_supervisor`，安装完成后交给 Compose restart policy 拉起正常服务
- 使用 `/qingyan/healthz` 做健康检查

## 数据库与 `drizzle/`

`drizzle/postgresql/` 是当前 PostgreSQL 基线，旧 `drizzle/0000_*.sql` 至已发布 SQLite SQL 保留冻结，仅供离线源版本识别与转换验证。两类资产均需入仓库。

原因很简单：它不是缓存，而是当前数据库结构的 migration 基线。没有它，就无法稳定重建 PostgreSQL schema，也无法保证不同环境使用的是同一版数据库结构。

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
pnpm test:smoke
pnpm test:system
pnpm build
pnpm check
pnpm check:system
pnpm dev:api
pnpm dev:admin
```

`pnpm check` 会串行执行格式检查、lint、typecheck、测试、构建和示例配置校验。
`pnpm test:system` 会运行 API/PostgreSQL 冒烟链路与 Admin Chromium E2E；
`pnpm check:system` 在完整静态与构建门禁后继续运行该系统测试。
真实邮件发送使用显式的 `pnpm test:smoke:commenter-email`，不会进入默认门禁。

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

如果只需要运行内置 mock，不希望连接或初始化 PostgreSQL，可使用无数据库模式：

```bash
QINGYAN_DATABASE_MODE=none QINGYAN_DEV_ADMIN_TOKEN=dev-token pnpm dev
```

无数据库模式会自动启用 dev mode，并使用进程内存状态提供完整 dev mock 控制面和前台业务 API；进程重启后 mock 状态会丢失。

dev mode 只新增 `/qingyan/api/dev/*` 控制面；正常业务接口仍然是 `/qingyan/api/*` 与 `/qingyan/admin`。前端在 dev mode 下依然需要显式传 `siteKey: "default"`。

更详细的下游联调方式、场景调用顺序、错误处理与 UI 对接建议见 [docs/dev-mode-integration.md](docs/dev-mode-integration.md)。
