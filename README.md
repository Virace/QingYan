# QingYan

![Node 24](https://img.shields.io/badge/node-%3E%3D24-43853d?logo=node.js&logoColor=white)
![TypeScript 6](https://img.shields.io/badge/typescript-6-3178c6?logo=typescript&logoColor=white)
![Fastify 5](https://img.shields.io/badge/fastify-5-000000?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-3-003b57?logo=sqlite&logoColor=white)
![OpenAPI](https://img.shields.io/badge/openapi-3.1-6ba539?logo=openapiinitiative&logoColor=white)

QingYan 是一个面向内容站点的第一方评论后端，当前基线服务于 FangYuan 一类内容站点的评论、验证码、页面点赞和后台管理需求。

它不是论坛系统、评论 SaaS，也不是第三方 provider 网关。当前仓库提供的是一个可自部署、可继续演进的最小后端基线。

## 当前能力

- 评论首屏 bootstrap：`GET /api/comments/bootstrap`
- 评论线程分页：`GET /api/comments/thread`
- 评论创建、投票、验证码验证
- bootstrap 返回 `commentForm.allow / require`，前端可按 `nickname | email | website` 动态渲染必填项
- 页面点赞
- 后台登录（管理员登录验证码 + 5 次失败永久封禁 IP）
- 后台评论审核、黑名单、页面管理、用户管理、访客管理、站点总览、运行时设置
- 浏览器后台入口：`GET /admin`
- SQLite + Drizzle migration 基线
- Docker / Compose 本地或单机部署

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备配置

```bash
cp config/qingyan.example.yml config/qingyan.yml
```

然后根据实际环境修改：

- `server.publicBaseUrl`
- `admin.tokenHash`
- `sites[].allowedOrigins`
- `database.sqlite.file`

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
- OpenAPI JSON: `http://localhost:4401/openapi.json`
- OpenAPI YAML: `http://localhost:4401/openapi.yaml`
- API Docs: `http://localhost:4401/docs`

## 配置文档

- 完整配置说明见 [docs/configuration.md](docs/configuration.md)
- 入库示例见 `config/qingyan.example.yml`
- 本地实参默认使用 `config/qingyan.yml`

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
pnpm dev:smoke
```

`pnpm check` 会串行执行格式检查、lint、typecheck、测试、构建和示例配置校验。
