# QingYan 部署指南

本文档记录当前 PostgreSQL 单一运行后端的自部署方式；已发布 SQLite 版本的实例先按 [离线转换与切换](postgresql-conversion.md) 交接，重点覆盖单机 Docker Compose，同时说明直接部署或托管运行时需要调整的安装切换策略。它面向实例部署和更新操作，不替代仓库发布流程。

## 部署边界

- QingYan 是有状态后端，部署时必须保护 `config/`、`data/` 和 `logs/`。
- `config/qingyan.yml`、`qingyan.installed.lock`、数据库备份、资源和日志不应打进镜像，也不应提交到仓库。
- 首次部署使用 `scripts/install.sh`，现有实例更新使用运行目录的 `update.sh` 或旧源码部署的 `scripts/update.sh`。安装器只准备程序和部署文件，不负责备份、恢复或数据搬运。
- Docker 使用 Node 24 trixie，并在运行镜像携带 PostgreSQL 18.7 客户端。数据库服务与应用分开管理。
- 程序更新前必须先备份当前实例；`qyctl upgrade` 只做数据升级，不负责下载或替换程序文件。
- Web 安装流程不会调用 `qyctl`、`systemctl` 或任意外部 shell 命令重启服务；安装完成后的切换行为由 `QINGYAN_INSTALL_TRANSITION_MODE` 决定。

## 推荐目录

脚本接受一个部署父目录，例如 `--dir /opt/1panel/apps`，默认生成：

```text
/opt/1panel/apps/
├── qingyan/
│   ├── compose.yml
│   ├── .env
│   ├── deployment.conf
│   ├── update.sh
│   ├── config/
│   ├── data/
│   └── logs/
└── .qingyan-source/
```

`config/` 保存 startup config 和安装锁，`data/` 保存 IP 库等本地资源、转换归档和升级备份；PostgreSQL 数据卷由数据库服务单独持久化，`logs/` 保存访问日志和应用日志。

`qingyan/compose.yml` 只引用本地构建的版本镜像，不包含 `build:`，也不挂载源码。`.env` 保存镜像引用和安装令牌，安装器将权限设为仅文件所有者可读写；更新时保留其他字段和文件权限。`deployment.conf` 记录版本、源码位置和网络来源，不保存应用密钥。`.qingyan-source/` 只在安装或更新构建时需要；没有构建任务运行时可以移除，下次更新会重新拉取，运行中的容器和重启不依赖该缓存。

源码位置可用 `--source-dir /其他位置` 覆盖，运行目录仍为 `<父目录>/qingyan/`。旧版源码、Compose 和持久文件混放的实例继续使用原布局，不自动搬移。

## 反向代理

建议给 QingYan 使用独立 HTTPS 域名，例如：

```text
https://qingyan.example.com
```

Nginx / 1Panel / Caddy 反代到容器内 `http://127.0.0.1:4401`。QingYan 默认只对外占用 `/qingyan/*`，反代不需要 rewrite：

```nginx
location ^~ /qingyan/ {
    proxy_pass http://127.0.0.1:4401;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

反代应转发常规头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

如果 QingYan 与 FangYuan / x-item 使用不同域名，公开评论接口依赖站点 `allowedOrigins` 做浏览器来源控制；安装时或 Admin Console 中需要把实际前端 origin 加进去，例如：

```text
https://x-item.com
https://www.x-item.com
```

## PostgreSQL 服务

当前运行后端固定 PostgreSQL 18.7：

```text
postgres:18.7@sha256:9f4fd4aa918f52ae3d6f3b687f1de90d8f867cd4d520021545a9a50c120eae3b
```

Node 24 trixie 运行镜像携带同一 PostgreSQL 18.7 的 `pg_dump` / `pg_restore` / `psql` 客户端。生产可复用共享 PG 服务，每个应用独立数据库和角色，运行账号不是 superuser。由数据库运维创建账号后，按数据库名和角色名替换以下示例；账号密码通过受保护入口设置：

```sql
CREATE DATABASE qingyan OWNER qingyan ENCODING 'UTF8'
  TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';
ALTER DATABASE qingyan SET timezone TO 'UTC';
```

应用角色需能连接并在本库创建和维护 schema、表、索引与序列；无需创建实例级角色。新装/转换/恢复目标必须为空，普通运行启动不会初始化故障数据库。数据库 URL、pool 与 TLS 见 [配置说明](configuration.md#database)。共享实例内其他应用由其独立角色管理，应用备份不会备份全局角色。

PG 18 官方镜像将持久卷挂载在 `/var/lib/postgresql`，默认 PGDATA 为 `/var/lib/postgresql/18/docker`，不要沿用旧镜像的 `/var/lib/postgresql/data` 挂载。共享 Docker 网络可用 PG 服务名连接；跨主机连接使用 TLS 和网络访问控制。Compose 不会自动启动一个数据库服务，连接由 `QINGYAN_DATABASE_URL` 或安装配置提供。

对 4 核、系统可见 3.64 GiB 且多个 Docker 服务共用的环境，应用池先按 `max=5`、连接等待 5 秒、空闲释放 30 秒运行。PG 的连接数、shared_buffers、work_mem 与应用/其他容器内存共同核算；备份、转换和索引构建留出额外空间。容量与维护窗口以同环境预演结果确定。

## 本地开发与测试数据库

普通开发配置使用 `QINGYAN_DATABASE_URL`，测试必须另设 `QINGYAN_TEST_DATABASE_URL`，指向专用本地 PG 实例。测试 fixture 创建并销毁自己生成的 `qingyan_test_<随机值>` 库，因此该测试账号需要 CREATEDB；不要授予生产应用账号，也不要把测试变量指向生产或用户共享实例。

以下示例创建独立本地测试服务，密码仅为本地示例：

```bash
docker run -d --name qingyan-test-pg -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=qingyan_test -e POSTGRES_PASSWORD=local-test-only \
  -e POSTGRES_DB=postgres \
  postgres:18.7@sha256:9f4fd4aa918f52ae3d6f3b687f1de90d8f867cd4d520021545a9a50c120eae3b
```

PowerShell 设置测试连接并运行现有门禁：

```powershell
$env:QINGYAN_TEST_DATABASE_URL = 'postgresql://qingyan_test:local-test-only@127.0.0.1:55432/postgres'
pnpm test
pnpm test:system
pnpm check
```

Linux/Bash 用 `export QINGYAN_TEST_DATABASE_URL='postgresql://qingyan_test:local-test-only@127.0.0.1:55432/postgres'`。纯函数测试可按原入口单独执行；数据库测试缺该变量会明确失败，不降级到 SQLite。API 冒烟与 Playwright 也使用真实隔离 PG；fixture 清理只删除自建随机数据库，本地工作文件按临时文件约定保留。真实 SQLite 只用于离线转换兼容验证，按转换文档提供只读样本。

## 首次部署

### 脚本入口

服务器需准备 Bash、Git、Docker、Compose 和 GNU coreutils（包括 `realpath`、`timeout`）；auto 构建依赖探测还需要 curl、awk。这些是常见 Linux 工具，脚本不会自行安装系统组件。

从当前源码或单独取得的安装脚本运行：

```bash
bash scripts/install.sh --dir /opt/1panel/apps
```

交互流程显示父目录、数据库和来源选项；数据库固定为 PostgreSQL，连接运维预建的空数据库与专用账号。非交互示例：

```bash
bash scripts/install.sh --dir /opt/1panel/apps --non-interactive \
  --database postgresql --github-source direct --network-profile official
```

安装器默认选择最高稳定 `vX.Y.Z` tag，可用 `--version <已发布的 PostgreSQL 版本 tag>` 固定源码版本；`v0.2.5` 仍为 SQLite 源版本，不能用它部署新 PostgreSQL 实例。父目录可以已有其他应用；若其中的 `qingyan/` 已有文件，安装器会停止并提示使用更新入口，不会覆盖原实例。

无需等待应用发布新版，即可从 `develop` 下载独立安装脚本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/develop/scripts/install.sh) --dir /opt/1panel/apps
```

脚本从哪个分支或提交下载，与最终安装哪个应用版本是两件事。应用源码仍默认使用最高稳定 tag，或由 `--version` 固定。需要固定脚本内容时，把 URL 中的 `develop` 换成包含安装器的提交 SHA；未来也可使用包含该脚本的 release tag，旧版 release 没有安装器。

无法直连 raw GitHub 时，使用代理入口下载同一份脚本：

```bash
bash <(curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/Virace/QingYan/develop/scripts/install.sh) \
  --dir /opt/1panel/apps --github-source proxy --github-proxy https://gh-proxy.org --network-profile cn
```

脚本未下载前还不能执行内部选源，因此需要分别提供下载入口。代理地址作为可配置前缀，脚本实际用 Git refs 查询和 clone 判断能否拉取源码，不以网页或 raw 下载可用作为 Git 可用的证明。

| 参数 | 含义 |
| --- | --- |
| `--dir <path>` | 父目录，默认当前工作目录；运行文件固定在其 `qingyan/` 子目录 |
| `--source-dir <path>` | 可选源码位置，默认父目录下的 `.qingyan-source/` |
| `--version <vX.Y.Z>` | 固定源码版本，默认最高稳定 tag |
| `--database postgresql` | 当前唯一运行后端，使用预建 PostgreSQL 18 数据库和专用账号 |
| `--github-source auto/direct/proxy` | 默认 auto，短超时探测 GitHub 直连，失败或超时后探测代理 |
| `--github-proxy <url>` | 代理前缀，默认 `https://gh-proxy.org` |
| `--network-profile auto/official/cn` | 构建依赖来源，与 GitHub 选源独立 |
| `--prepare-only` | 只准备文件，不构建或启动服务 |
| `--non-interactive` | 使用参数与默认值，不询问安装选项 |
| `--interactive` | 显式启用交互，例如从标准输入传入选择 |

`auto` 的 GitHub 探测上限默认 5 秒，可通过 `QINGYAN_GITHUB_PROBE_TIMEOUT` 调整。构建依赖 auto 分别探测官方与国内的 APT 和 npm，选择可用且耗时较低的一组。显式指定来源时不会静默切换。GitHub 代理和构建依赖源不会改变 Docker daemon 的基础镜像拉取配置。

构建完成后 Compose 启动安装服务。运行 Compose 已设置容器监听 `0.0.0.0`，端口映射为 `4401:4401`。安装器自动生成安装令牌，将其保存在运行目录 `.env` 的 `QINGYAN_INSTALL_TOKEN` 字段并注入容器；需要在安装页填写令牌时从该文件读取，脚本输出中不回显令牌值。

容器启动不代表业务安装已完成，继续访问 `/qingyan/admin/install`，由镜像内安装程序写配置、建表、初始化默认数据和安装锁。安装前应先准备下文的 PostgreSQL 服务；安装仅初始化空目标，不创建数据库服务或角色。

首次构建失败时文件会保留；修复网络或 Docker 问题后，可从运行目录执行 `bash update.sh --start`，按准备时的版本重新构建并启动。

### 仅准备文件

`--prepare-only --version <目标版本>` 只准备运行布局，不读备份、不搬数据库。`bash update.sh --start` 按准备时版本构建并启动，不执行升级。搬迁现有 PostgreSQL 实例时，先完成 [整实例备份与恢复](#备份与恢复)，旧 SQLite 则先执行 [离线转换](postgresql-conversion.md)。不要将旧 SQLite 配置直接放入新程序后当作新安装。

### 手动源码部署：准备服务器目录

该方式需要先在目标工作目录放置完整 QingYan 源码，仅复制 Compose 文件无法完成本地构建。新部署可直接使用前面的安装脚本。

```bash
mkdir -p /opt/1panel/apps/qingyan/config
mkdir -p /opt/1panel/apps/qingyan/data
mkdir -p /opt/1panel/apps/qingyan/logs
cd /opt/1panel/apps/qingyan
```

### 手动源码部署：放置 Compose 文件

可以直接使用仓库根目录的 `compose.yml` 作为起点。部署时建议只在服务器环境里调整端口和环境变量，不把服务器专用配置提交回仓库。

默认 Compose 会设置：

```yaml
environment:
  QINGYAN_INSTALL_TRANSITION_MODE: exit_for_supervisor
```

这表示首次安装完成后 QingYan 进程主动退出，由 Compose 的 `restart: unless-stopped` 重新拉起正常服务。直接部署、PaaS 或 serverless-like 运行时不要照搬这个值，通常应使用默认的 `reload_in_process`，或在无法安全 reload 时显式使用 `manual`。

如果需要让服务只被本机反代访问，可以把端口映射改成：

```yaml
ports:
  - "127.0.0.1:4401:4401"
```

### 手动源码部署：启动 install mode

首次部署时不要预先创建 `config/qingyan.yml`。让 QingYan 进入 install mode：

```bash
docker compose up -d --build
docker compose logs -f qingyan
```

日志中应出现类似：

```text
install.url=http://127.0.0.1:4401/qingyan/admin/install
```

通过反代域名访问：

```text
https://qingyan.example.com/qingyan/admin/install
```

### 4. 安装表单建议值

单机部署建议：

- `server.host`: `0.0.0.0`
- `server.port`: `4401`
- `server.publicBaseUrl`: 用户实际访问 QingYan 的 HTTPS origin，例如 `https://qingyan.example.com`，不是容器内默认的 `http://localhost:4401`
- `server.publicPath`: `/qingyan`；如果改成其他路径，必须同步调整反向代理 location/path rewrite，否则 Admin、API 和 Cookie path 会不匹配
- `server.trustProxy`: `true`
- `database.url`: 运维预建的 PostgreSQL 专用库连接；通过安装表单填写或受保护环境变量 `QINGYAN_DATABASE_URL` 注入，完整 URL 按 secret 保管
- `admin.session.secure`: HTTPS 下设为 `true`；HTTP 本地测试不要启用
- `admin.session.sameSite`: 同站后台可用 `lax`；如后续必须跨站携带后台 cookie，再评估 `none`
- `security.publicOriginGuard.enabled`: `true`
- `security.publicOriginGuard.allowMissingOrigin`: `false`
- `security.adminOriginGuard.enabled`: `true`
- 站点 `allowedOrigins`: 填 FangYuan / x-item 的实际访问 origin

安装完成后的切换模式：

- `reload_in_process`：默认模式，不依赖外部 CLI 或 supervisor，安装完成后关闭 install app 并在同一进程内启动正常服务，适合直接运行、PaaS 或 serverless-like 环境。
- `exit_for_supervisor`：安装完成后进程退出，交给 Docker Compose、systemd 或其他守护进程拉起，适合当前 Compose 部署。
- `manual`：安装完成后停留在完成页，提示人工重启，适合运行时不允许进程自切换或没有可靠 supervisor 的环境。

如果 Compose 部署没有自动恢复，手动执行：

```bash
docker compose restart qingyan
```

## 部署后验证

### 1. 容器状态

```bash
docker compose ps
docker compose logs --tail=200 qingyan
```

容器应处于 running / healthy，日志不应持续出现 `service.crashed`。

### 2. 基础 HTTP

```bash
curl -i https://qingyan.example.com/qingyan/healthz
curl -i https://qingyan.example.com/qingyan/openapi.json
```

`/qingyan/healthz` 应返回 `200`，内容包含 `status: ok`。

### 3. Admin Console

安装完成页会给出初始管理员信息和控制台入口。登录后至少验证：

- 能打开总览页。
- 能查看站点列表。
- 能查看系统设置。
- 能查看任务中心、IP 当前激活与最近检查结果；确认没有导入导出或定时备份入口。

如果需要重置后台入口：

```bash
docker compose exec qingyan qyctl admin entrance
```

如果需要重置管理员密码：

```bash
docker compose exec qingyan qyctl admin repass
```

Docker 镜像内同时提供 `qyctl` 和 `qingyanctl` 两个等价入口。它们用于服务器运维、备份、恢复、升级和重置后台信息；首次安装的 Web 生命周期不依赖这些 CLI 存在。

可以用以下命令确认容器内 CLI wrapper 存在并查看可用子命令：

```bash
docker compose exec qingyan qyctl help
docker compose exec qingyan qingyanctl --version
```

容器生命周期仍由 Docker Compose 管理；不要把 `qyctl start/stop/restart` 当作 Compose 容器启停入口。

### 4. FangYuan / x-item 集成

在 FangYuan / x-item 配置中把评论 API 指向 QingYan 域名后，至少验证。若与 x-item 同域部署，推荐配置 `qingyanConfig.apiBase: /qingyan/api`，一条 `/qingyan/` 反代即可接入 QingYan：

- 评论 bootstrap 正常返回。
- 评论列表分页正常。
- 普通评论创建流程正常。
- 验证码策略符合预期。
- 评论点赞和页面点赞正常。
- Admin Console 能看到新评论、新访客和页面线程。

如果浏览器请求被拒绝，优先检查站点 `allowedOrigins` 是否包含当前页面的精确 origin。

## 备份与恢复

整实例备份和升级前备份都要求停写：阻止公开与后台写入，停止 scheduler/worker 和自动清理，等待在途请求与外部发送收敛。Compose 使用独立一次性容器执行命令，数据库保持运行：

```bash
docker compose stop qingyan
docker compose run --rm --no-deps qingyan qyctl backup /app/data/backups/full-before-upgrade --yes --service-stopped
```

`--service-stopped` 是运维对停写完成的明确声明，不会替你停止容器。systemd 直接部署可由 CLI 管理已知服务状态的停写；未知服务状态时不要绕过检查。

备份为 `qingyan.full-backup` 目录包，数据库使用 `pg_dump -Fc`，同时保存配置、安装锁、必要资源、版本和 manifest。完整备份含数据库凭据、内容与用户信息，仅允许受保护存储与传输。应用备份不包含共享 PG 实例的角色和全局对象；由数据库运维另外维护。

升级前备份使用同一目录包格式，另含已脱敏的 `upgrade-plan.json` 和来源/目标版本；`qyctl restore` 可直接读取升级结果的 `backupDirectory`。包内数据库位于 `database/qingyan.dump`，启动配置位于 `config/qingyan.yml`，`manifest.json` 在所有文件与校验和写入成功后生成。

先检查备份与恢复计划：

```bash
docker compose run --rm --no-deps qingyan qyctl restore /app/data/backups/full-before-upgrade.qingyan-backup --dry-run
```

由运维创建新的空目标数据库及账号，将连接信息写入权限受限的 `config/restore-target.yml`，配置结构见配置文档。选用独立恢复目录，确保首次恢复时输出文件及同名 `.restore` 目录尚不存在；命令会创建输出配置的父目录，无 TLS 时也一样：

```bash
docker compose run --rm --no-deps qingyan qyctl restore /app/data/backups/full-before-upgrade.qingyan-backup --yes --service-stopped --target-config /app/config/restore-target.yml --output-config /app/config/restored/qingyan.yml
```

恢复在数据库写入前校验备份路径、校验和、启动配置及资源归属，并将新配置与资源准备到 `<output-config>.restore/`。随后调用 `pg_restore --no-owner --no-acl --exit-on-error --file` 展开 custom dump，再通过 `psql --no-psqlrc --single-transaction` 和 `ON_ERROR_STOP` 执行；事务内再次拒绝非空目标，数据库导入、资源路径更新与 `__qingyan_restore_receipts` 完成收据一起提交，失败整体回滚。备份内已有的历史恢复收据保留，本次使用独立恢复 ID。恢复后核对结构账本和实例数据，再以不覆盖已有文件的方式发布新配置；不覆盖当前配置或旧数据库。

数据库提交后文件发布失败，或进程在提交后中断时，保持应用停写并原样重跑上面的恢复命令。备份内容、目标配置、输出路径和程序版本必须一致；命令核对 `.restore/restore.json` 与数据库收据，已提交时跳过数据库导入，仅重新核验并发布配置；未提交时只允许向仍为空的目标重试。现存输出文件只有属于本次恢复且内容完全一致时才能复用。请求不一致、资源/配置被修改、恢复状态损坏或非空目标缺少匹配收据时直接拒绝，不自动删库、清库或覆盖文件；需先由运维核对目标与恢复产物。若前次数据库进程尚在提交，立即重试可能暂时被拒绝，待其退出后原样重试。

示例会保留 `/app/config/restored/qingyan.yml.restore/`，其中 `resources/` 是数据库实际引用的恢复资源，`qingyan.yml` 为新配置暂存，`restore.json` 为重试凭据；还包含展开的 `database-*.sql`、事务脚本及使用 TLS 时的 `credentials/`。这些文件含原始数据或密钥，按完整备份保护，预留展开 SQL 所需磁盘空间。运行配置引用这些资源期间不得删除或移动整个目录；中断留下的 `.tmp` 或 SQL 文件也保留供运维检查。命令不自动清理恢复产物。

结果中的 `configurationSwitched=false` 表示还没有切换。先用同版本程序、恢复配置和恢复资源验证，再在停写窗口切换受保护的配置或部署引用，之后启动 `docker compose up -d qingyan`。不要把恢复目标的环境 URL 留成原库 URL，环境优先级高于文件。

后台与安装页不再接受 QingYan export 恢复，不提供 WordPress 导入或定时备份。SQLite 回滚用冻结一致快照、匹配旧程序和旧配置；不能将 PostgreSQL 备份直接交给旧程序。

## 更新流程

新脚本布局从运行目录执行 `bash update.sh`；旧源码部署继续执行 `bash scripts/update.sh`。固定目标使用 `--version <PostgreSQL 发布 tag>`（旧布局允许位置参数 tag）；`--yes` 接受脚本已有确认。数据库改造尚未正式发布时，不以旧 SQLite tag 代替目标版本。

更新器准备源码、构建目标镜像、展示脱敏 UpgradePlan 后，停止应用容器，再通过 `compose run --rm --no-deps` 执行备份与升级；成功后启动应用并验证版本及 `normal_current` 就绪状态。minimal install/upgrade 健康状态只表示对应模式可操作，不代表正常业务已经恢复。升级失败保持停写并保留备份与 partial marker，不擅自覆盖配置或库。

- 首次从 SQLite 到 PostgreSQL：普通 `qyctl upgrade --yes` 明确交接给独立离线转换，不会执行旧 SQLite SQL，也不会自动搬数据，使用 [离线转换方案](postgresql-conversion.md)。
- 后续 PostgreSQL 升级：先 `qyctl upgrade --dry-run` 审查计划，再按停写入口执行 `qyctl upgrade --yes --service-stopped --backup-dir <目录>`；CLI/Web 共用执行服务与备份约定。
- 需要恢复已完成数据库的剩余文件步骤：`qyctl upgrade --recover --yes --service-stopped`。该命令会核对 marker 目标身份、程序版本和 PG 完成事实；无法确认的状态要求备份恢复，不可直接移除 marker。

GitHub 下载来源与构建依赖来源仍分别选择：`--github-source auto|direct|proxy`、`--github-proxy <前缀>` 与 `--network-profile auto|official|cn`。明确来源时不会中途切换，且不改写 Git origin 或 Docker daemon 基础镜像来源。运行目录中的配置、资源、日志和 .env 自定义字段按安装器约定保留。

## 回滚

新库尚未接受真实写入时，停止新程序，恢复匹配旧程序、配置、冻结数据库与同一时点资源，再恢复原 worker。数据库已执行 PostgreSQL 升级时，先恢复备份到独立空目标，配套验证后再切换配置。不要只替换镜像而忽略数据库版本。

新库已接受真实写入后，直接退回冻结旧库会丢失新评论、设置和发送结果。先停写并保存新库，优先修复新程序；若必须退回，另行核对新增数据回迁或由用户确认数据窗口。已被服务商接受的邮件或 webhook 无法通过数据库回滚撤回。

## 后续扩展

CI、镜像 registry 或服务器面板任务复用更新器的停写、备份、UpgradePlan 与健康验收边界。当前仍按单服务 Docker Compose 交付；共享数据库不意味着本地 IP 资源或 scheduler 已支持多实例。
