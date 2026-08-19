# QingYan 部署指南

本文档记录 QingYan `v0.1.0` 及后续版本的自部署方式，重点覆盖单机 Docker Compose，同时说明直接部署或托管运行时需要调整的安装切换策略。它面向实例部署和更新操作，不替代仓库发布流程。

## 部署边界

- QingYan 是有状态后端，部署时必须保护 `config/`、`data/` 和 `logs/`。
- `config/qingyan.yml`、`qingyan.installed.lock`、SQLite 数据库和日志不应打进镜像，也不应提交到仓库。
- 当前推荐先手动部署并验证真实链路；自动化发布、拉取和替换程序文件应在备份与升级流程固定后再接入。
- `v0.2.2` 的 Docker 依赖构建阶段将 Debian 主仓库固定为 TUNA HTTP，并保留基础镜像默认的 Debian security 源；仓库元数据继续由 Debian keyring 验签，同时启用 3 次重试、30 秒 HTTP 超时和 IPv4。使用 HTTP 是因为 `node:24-bookworm-slim` 在安装依赖前没有 CA 证书；直接切换 TUNA HTTPS 会导致证书校验失败和 APT exit 100。
- 程序更新前必须先备份当前实例；`qyctl upgrade` 只做数据升级，不负责下载或替换程序文件。
- Web 安装流程不会调用 `qyctl`、`systemctl` 或任意外部 shell 命令重启服务；安装完成后的切换行为由 `QINGYAN_INSTALL_TRANSITION_MODE` 决定。

## 推荐目录

服务器上建议使用独立工作目录，例如：

```text
/opt/1panel/apps/qingyan
├── compose.yml
├── config/
├── data/
└── logs/
```

`config/` 保存 startup config 和安装锁，`data/` 保存 SQLite 数据库、导入备份和升级备份，`logs/` 保存访问日志和应用日志。

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

## 首次部署

### 1. 准备服务器目录

```bash
mkdir -p /opt/1panel/apps/qingyan/config
mkdir -p /opt/1panel/apps/qingyan/data
mkdir -p /opt/1panel/apps/qingyan/logs
cd /opt/1panel/apps/qingyan
```

### 2. 放置 Compose 文件

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

### 3. 启动 install mode

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
- `database.sqlite.file`: `./data/qingyan.db`
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
- 能执行数据导出 dry-run 或普通导出。

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

## 备份

更新程序、调整数据库或大批量导入前，先做整站备份：

```bash
docker compose exec qingyan qyctl backup /app/data/backups/full-$(date +%Y%m%d%H%M%S) --yes
```

备份完成后可以用 dry-run 检查恢复计划：

```bash
docker compose exec qingyan qyctl restore /app/data/backups/<backup-dir> --dry-run
```

普通 QingYan JSON export/import 只用于站点业务数据迁移，不等同于整站备份。

安装页中的“从 QingYan 站点导出 JSON 恢复”只接受 QingYan 站点级 JSON export，用于首装时恢复站点、评论、页面线程、访客和站点设置。它不是整站恢复入口，不接受 `qyctl backup` 生成的 `.qingyan-backup` 包；整站恢复继续使用 `qyctl restore <backup> --dry-run` 和停服务覆盖恢复流程。

## 更新流程

Docker Compose 部署不再要求逐条执行备份、切 tag、构建、升级和检查命令。在 QingYan
仓库根目录运行一个入口：

```bash
./scripts/update.sh                             # auto，默认优选
./scripts/update.sh --network-profile cn        # 中国大陆镜像
./scripts/update.sh --network-profile official  # 官方源
```

`auto` 会在备份和切换 release 前分别探测官方组与中国大陆镜像组的 APT、npm registry 和 Node headers，选择总耗时较低且可用的一组。配置档同时固定本次构建的 Corepack、pnpm、Node headers 与 better-sqlite3 下载地址；不会改写 Git origin，也不负责 Docker 基础镜像加速。

显式选择 `official` 或 `cn` 时不做中途回退，脚本会打印所有实际使用的地址，便于复现构建与定位网络问题。

`v0.2.2` 之前的 checkout 尚无该脚本，第一次更新使用固定版本的远程入口：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Virace/QingYan/v0.2.5/scripts/update.sh)
```

GitHub 直连困难的地区可使用同一固定 release 的代理入口：

```bash
bash <(curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/Virace/QingYan/v0.2.5/scripts/update.sh)
```

`v0.2.5` 远程脚本支持相同的 `--network-profile` 参数；需要固定网络配置档时，可在脚本路径后追加 `--network-profile official` 或 `--network-profile cn`。远程入口保留 `bash <(...)` 形式，以避免 `docker compose exec` 继承并消费 `curl | bash` 的标准输入。

脚本默认 fetch tags 后选择最高的稳定 `vX.Y.Z` release，也允许指定目标版本：

```bash
./scripts/update.sh v0.2.5
```

默认交互流程只需要确认两次：第一次确认目标版本和整站备份，第二次在脚本显示脱敏
`UpgradePlan` 后确认数据升级。明确接受全部确认时可以使用：

```bash
./scripts/update.sh --yes v0.2.5
```

脚本内部负责：

1. 校验 Git、Docker、Compose 和运行中的 `qingyan` 容器；仅允许已跟踪的 `compose.yml` 存在本地修改。
2. 用旧容器的 `qyctl backup` 创建升级前整站备份。
3. 安全暂存 `compose.yml` 与未跟踪部署文件，切换目标 release tag 后原样恢复，并以 plain progress 构建新镜像。
4. 启动新容器并确认进程运行，显示 `qyctl upgrade --dry-run` 的 UpgradePlan。
5. 确认后应用数据升级，重启并校验容器版本、更新状态和健康状态。

`0.2.5` 会应用 `0003_comment_email_delivery_observability.sql`，为评论关联的通知任务增加组合查询索引。该迁移不重写评论、任务或投递数据；既有通知事实会直接按新聚合规则读取，完全没有历史事实的评论保持“未知”。从更早版本升级时，升级流程仍会按顺序应用尚未执行的迁移。升级前必须保留更新脚本生成的整站备份，并确认脱敏 UpgradePlan。

在新容器激活前发生失败，脚本会自动恢复原 Git revision 和原本的本地部署文件；运行中的旧容器不会被构建失败替换。
新容器已经开始激活或数据升级后发生失败时，脚本不会擅自覆盖数据库或配置，而会输出失败
阶段、原 revision、整站备份路径和最近 200 行容器日志。

生产目录可以保留本地 `compose.yml` 定制和未跟踪运维文件；更新器会在切换 tag 前安全暂存、在新 tag 上恢复，并在成功后保持原 Git 状态。其他已跟踪源码改动仍会在备份前阻断更新。`config/`、`data/` 和 `logs/` 由 `.gitignore`
排除，不参与这次暂存。更新成功后仍应完成评论邮件双链路的真实收件箱验收。

## 回滚

回滚优先级：

1. 如果只是新容器启动失败，先回到上一版镜像或上一份程序文件。
2. 如果数据库尚未执行升级，直接用旧程序启动。
3. 如果已经执行升级，按升级前整站备份恢复 `config/`、`data/` 和安装锁。

不要只恢复 SQLite 文件而忽略 `config/qingyan.yml` 和 `qingyan.installed.lock`；这三者属于同一个实例状态。

## 后续扩展

后续如果接入 GitHub Actions、镜像 registry 或服务器面板任务，应复用 `scripts/update.sh` 的
备份、UpgradePlan 和健康验收边界，不再另写一套需要用户逐条执行的更新步骤。当前生产唯一
支持的更新入口是 Docker Compose 脚本；systemd 不在本版本范围内。
