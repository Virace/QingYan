# QingYan 测试部署指南

本文档记录 QingYan 当前测试版的部署方式，重点覆盖单机 Docker Compose，同时说明直接部署或托管运行时需要调整的安装切换策略。它面向“先部署，后更新”的测试策略，不等同于正式 release 流程。

## 部署边界

- QingYan 是有状态后端，部署时必须保护 `config/`、`data/` 和 `logs/`。
- `config/qingyan.yml`、`qingyan.installed.lock`、SQLite 数据库和日志不应打进镜像，也不应提交到仓库。
- 当前推荐先手动部署并验证真实链路，等测试版稳定后再补 GitHub Actions 或 release 自动化。
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

建议给测试版 QingYan 使用独立 HTTPS 域名，例如：

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

可以直接使用仓库根目录的 `compose.yml` 作为起点。测试部署建议只在服务器环境里调整端口和环境变量，不把服务器专用配置提交回仓库。

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

测试部署建议：

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
- `exit_for_supervisor`：安装完成后进程退出，交给 Docker Compose、systemd 或其他守护进程拉起，适合当前 Compose 测试部署。
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

### 4. FangYuan / x-item 集成

在 FangYuan / x-item 测试配置中把评论 API 指向 QingYan 测试域名后，至少验证。若与 x-item 同域部署，推荐配置 `qingyanConfig.apiBase: /qingyan/api`，一条 `/qingyan/` 反代即可接入 QingYan：

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
docker compose exec qingyan qyctl backup /app/data/backups/full-$(date +%Y%m%d%H%M%S)
```

备份完成后可以用 dry-run 检查恢复计划：

```bash
docker compose exec qingyan qyctl restore /app/data/backups/<backup-dir> --dry-run
```

普通 QingYan JSON export/import 只用于站点业务数据迁移，不等同于整站备份。

安装页中的“从 QingYan 站点导出 JSON 恢复”只接受 QingYan 站点级 JSON export，用于首装时恢复站点、评论、页面线程、访客和站点设置。它不是整站恢复入口，不接受 `qyctl backup` 生成的 `.qingyan-backup` 包；整站恢复继续使用 `qyctl restore <backup> --dry-run` 和停服务覆盖恢复流程。

## 更新流程

测试版更新建议先手动执行：

```bash
cd /opt/1panel/apps/qingyan
docker compose exec qingyan qyctl backup /app/data/backups/pre-update-$(date +%Y%m%d%H%M%S)
docker compose build --pull qingyan
docker compose up -d qingyan
docker compose logs --tail=200 qingyan
```

如果新版本启动进入 Web Upgrade Mode，日志会输出：

```text
upgrade.url=http://127.0.0.1:4401/qingyan/upgrade
```

此时访问反代后的 `/qingyan/upgrade`，确认脱敏 `UpgradePlan` 后执行升级。也可以用 CLI 先 dry-run：

```bash
docker compose exec qingyan qyctl upgrade --dry-run
```

只有确认备份和计划无误后再 apply。

## 回滚

测试部署阶段的回滚优先级：

1. 如果只是新容器启动失败，先回到上一版镜像或上一份程序文件。
2. 如果数据库尚未执行升级，直接用旧程序启动。
3. 如果已经执行升级，按升级前整站备份恢复 `config/`、`data/` 和安装锁。

不要只恢复 SQLite 文件而忽略 `config/qingyan.yml` 和 `qingyan.installed.lock`；这三者属于同一个实例状态。

## 后续自动化建议

手动部署跑通后，再补 GitHub Actions 或服务器脚本。自动化应至少包含：

- 构建镜像或程序包。
- 上传到服务器的受限路径。
- 更新前执行 `qyctl backup`。
- 替换程序或镜像。
- 启动服务并检查 `/qingyan/healthz`。
- 如果进入 `upgrade_required`，停止自动流程并要求人工确认 UpgradePlan。

在这些条件未固定前，不建议把 QingYan 绑定到 x-item 的静态站部署 workflow。
