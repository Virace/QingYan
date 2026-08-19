# QingYan 当前设计

## 1. 系统边界

QingYan 是自部署、API-first 的评论与对话基础设施。一个 Node.js 服务负责公开内容 API、Admin API、Admin 静态资源、后台任务、通知、安装与升级入口；Admin Console 是同仓库构建并随服务端交付的 React SPA。

当前主要消费者是内容站点与内置 Admin Console。内容站点只依赖公开 HTTP 合同，不依赖仓库模块、数据库表或 Admin API。

## 2. 顶层目录职责

| 路径 | 职责 |
| --- | --- |
| `src/server.ts` | 解析 install/upgrade/normal 启动状态并管理进程生命周期 |
| `src/app.ts` | 组合正常模式 Fastify plugins、基础路由和 feature routes |
| `src/config/` | startup config、环境变量、public path 与 dev runtime options |
| `src/db/`、`drizzle/` | SQLite 客户端、schema、迁移执行与已发布 SQL |
| `src/modules/` | 按 admin、comments、notifications、tasks、install、upgrade 等稳定能力组织业务 |
| `src/plugins/` | DB、安全、request context、日志、cookie 的 Fastify 生命周期装配 |
| `apps/admin/` | React Admin Console、API client、页面/组件与 Vite 构建 |
| `scripts/` | 开发编排、升级、回填、导入转换和专项 smoke 入口 |
| `tests/` | Vitest、Playwright、Bash 系统测试与共享 fixture |
| `docs/` | 公开 OpenAPI、Admin API、配置、部署和联调说明 |

## 3. 启动与组合

`src/server.ts` 先根据安装锁、startup config、SQLite 版本和 partial marker 解析状态：

- `not_installed` 启动 minimal install app；
- `upgrade_required` 启动 Web Upgrade Mode；
- `recovery_required` 或配置损坏进入受控恢复/错误状态；
- `normal_current` 加载完整配置并调用 `buildApp(...)`。

正常模式的 `src/app.ts` 按以下顺序组合：

1. 创建 Fastify，注册统一错误处理。
2. 注册 cookie、DB、request context、安全与日志 plugins。
3. 注册 health、OpenAPI、docs 和 Admin 静态资源。
4. 在 `${publicPath}/api` 下注册公开评论、验证码和页面反馈能力。
5. 在 `${publicPath}/api/admin/*` 下注册内置 Admin 能力。
6. 通过 DB plugin 装配站点 registry、任务 scheduler/worker、通知 runtime 和外部 adapters。

内存 dev mode 是受限分支：它不连接 SQLite，只注册内存 mock 与 dev 控制面，不代表生产持久化行为。

## 4. 请求与错误数据流

典型公开或 Admin 请求数据流为：

1. request context 生成/传播 request ID，并识别站点、页面和访问元数据。
2. 安全 plugin 执行 Origin、身份、ACL、限流、黑白名单或审计边界。
3. feature route 使用 Zod/明确 schema 校验输入并调用 service。
4. service 执行业务规则，repository 通过 Drizzle/SQLite 读写状态；外部发送或抓取通过 adapter。
5. presenter/route 只返回边界模型，不直接暴露数据库行或内部任务 payload。
6. `AppError` 转换为稳定 HTTP 状态、错误码、安全 message 和 request ID；未知异常写入脱敏日志并返回 `INTERNAL_ERROR`。

内部 TypeScript 类型不承担运行时验证。环境变量、YAML、HTTP body、导入文件、外部响应和数据库 JSON 在进入受信业务逻辑前必须解析或校验。

## 5. 持久化、任务与通知

- SQLite/Drizzle 是当前正式持久化边界；启动时 `applyDatabaseMigrations(...)` 使用 `__qingyan_migrations` ledger 应用版本 SQL。
- 站点、页面、评论、访问元数据、Admin 身份、settings、任务、通知投递和 upgrade ledger 分属明确 schema 模块。
- `task_runs` 是可审计任务状态中心；scheduler 创建到期运行，worker 通过锁/lease 认领并写入进度、结果、错误和 event log。通知任务创建时，`task_runs`、`notification_deliveries` 与首条 task event 在一个 SQLite 事务内落库；一次外部发送完成后，delivery 结果、父任务终态/重试态与对应 task events 也在一个事务内提交，网络 I/O 不进入数据库事务。
- 默认 queue backend 为数据库。BullMQ 可传递消息，但 task/delivery 的业务状态仍持久化在 SQLite。
- 通知 planner 决定事件与接收人，queue 创建工作，worker 选择 channel adapter，delivery/reputation/event log 记录可诊断结果。评论邮件即使决定不发送，也会写入终态 decision task 作为业务事实；评论列表、评论邮件明细和任务详情通过同一聚合器把任务与投递映射为 `accepted | failed | processing | not_sent | unknown`，对评论页列表使用固定次数的批量查询。
- 通知的 Admin 投影只返回业务 workflow、脱敏收件人、尝试次数、安全原因和接受时间；原始 payload、底层异常、provider message id 与 secret 留在受保护的内部持久化/日志边界，不进入评论接口或通知任务视图。
- 配置 owner 分离：startup config 保存启动必需项；站点/系统设置保存在数据库；secret 通过受控设置或环境 seed 进入持久化边界。

## 6. Admin Console

`apps/admin/vite.config.ts` 把 React SPA 构建到 `dist/admin`。服务端根据 `publicPath` 与数据库中的 Admin 入口注入运行时 `basePath` / `apiBase`，并提供静态资源和 SPA shell。

Admin API client 位于 `apps/admin/src/api/`；页面和组件按内容、设置、任务、用户、运维等工作流分组。页面只消费稳定 API 边界，错误码先映射为产品可执行文案，保存结果以服务端响应或重新读取为准。

## 7. 外部合同

- `docs/openapi.yaml` 描述内容站点直接使用的公开 API，并由 `/openapi.yaml`、`/openapi.json`、`/docs` 提供运行时视图。
- 公开 route schema、presenter 和 `tests/integration/public-api-contract.test.ts` 必须与 OpenAPI 同步。
- Admin API 是内置 code-first 合同，开发说明维护在 `docs/admin-console-api.md`。
- startup YAML 与环境变量边界维护在 `config/qingyan.example.yml`、`src/config/` 和 `docs/configuration.md`。
- Docker/Compose、CLI、backup/export 与 updater 都是运维合同；修改参数、输出或恢复语义时必须同步文档和系统测试。

## 8. 安装、升级与恢复

install app 只处理全新实例，完成后写 startup config、SQLite、Admin bootstrap、默认 settings 和安装锁。release 后升级先生成脱敏 `UpgradePlan`，在写入前备份 config、SQLite/WAL/SHM 和计划，再按 migration 与 application step 执行并写入 upgrade ledger。

升级失败保留 partial marker 并进入 `recovery_required`，不得继续启动正常服务。CLI 与 Web Upgrade Mode 复用同一升级服务；Web 层不调用 shell 或 `systemctl`。

## 9. 尚未决定

- PostgreSQL/MySQL、多实例共享存储和水平扩展不在当前支持范围。决定这些能力前需要明确部署拓扑、事务/锁语义、备份责任和迁移兼容窗口。
- 公开 API 的下一版本化方式尚未触发。只有出现无法通过向后兼容扩展完成的真实需求时，才评估路径版本、媒体类型或其他策略。
- 真实外部 Redis、SMTP、Webhook/WxPusher 和生产反向代理的统一 CI 环境尚未建立；当前由显式环境测试与部署验收承担。
