# QingYan 项目约束

## 1. 技术与版本边界

- 运行时要求 Node.js `>=24.0.0`，使用 `pnpm@10.33.0` 与受版本控制的 `pnpm-lock.yaml`。
- 服务端技术栈为 Fastify 5、TypeScript 6、Zod 4、Drizzle ORM 和 SQLite；当前不承诺 PostgreSQL、MySQL 或多数据库兼容。
- 服务端输出为 CommonJS，启动入口是 `node dist/server.js`；Admin 由 Vite 构建到 `dist/admin` 后随服务端提供。
- Docker 基线为 `node:24-bookworm-slim`。Compose 面向单机部署，持久目录为 `config/`、`data/`、`logs/`。
- `drizzle/` 是发布与升级所需资产，必须入库；`dist/`、`.temp/`、数据库文件、日志和本地配置不得提交。

## 2. 公开兼容与升级

- 内容站点通过公开 HTTP API 解耦；公开合同由 `docs/openapi.yaml`、运行时行为和契约测试共同约束。
- Admin `/api/admin/*` 是内置后台合同，不进入公开 OpenAPI，但修改时必须同步 `docs/admin-console-api.md` 和对应 API/UI。
- 首个正式 release 已发布，schema、startup config、settings owner、secret 存储或导出语义的破坏性变化必须进入 upgrade lifecycle。
- 已发布迁移文件冻结；后续数据库变化新增版本迁移，并在下一 release 前按 `AGENTS.md` 整理同一版本周期内的碎片。
- install 只处理 `not_installed`，upgrade 只处理 `upgrade_required`；`recovery_required` 和 `broken_config` 不得被静默当作正常启动。

## 3. 安全与隐私

- 不在源码、文档、测试 fixture 或提交信息中写入真实密钥、SMTP 密码、token、用户凭证或生产连接信息。
- startup config 只保存启动必需信息；DB-owned settings 与 secret 的 owner 不得无升级方案迁回 YAML。
- 普通 export 不包含 SMTP/captcha secret。完整备份、升级备份和诊断输出必须保持脱敏边界。
- API 不返回原始异常、堆栈、SQL、文件系统位置、队列内部信息或服务商敏感响应；客户端使用稳定错误码和 `requestId`。
- Admin UI 不展示内部 route、字段 path、任务/投递 ID、worker/队列术语或后端原始错误；产品文案遵循 `PRODUCT.md`。
- 公共抓取、页面来源和跳转必须保留 SSRF、Origin、限流、大小和超时保护；不得为了联调绕过生产安全边界。

## 4. 测试与验证约束

- 禁止以读取源码文件后的字符串/正则断言证明实现存在；测试必须观察 API、函数、数据库、文件产物、日志或浏览器行为。
- 数据库事务、迁移、锁、备份与恢复使用真实 SQLite/文件语义验证，不以纯 mock 替代。
- `app.inject(...)` 已能证明的 API 行为不额外复制为浏览器测试；Admin 交互、布局和前端路由风险使用 Playwright。
- 真实 Redis、SMTP、Webhook、WxPusher、Docker 网络、收件箱到达和生产升级属于显式环境门禁；缺少环境时必须报告未验证，不能把 skip 当成通过证据。
- 测试只能清理自己创建的临时目录、数据库、进程和容器，不终止现有开发或生产进程。

## 5. 禁止事项

- 未经明确确认，不修改公开 API、共享 schema、迁移历史、权限边界、secret owner、部署基础设施或 release 流程。
- 不直接在 `main` 做日常开发；分支、PR、合并和发布遵循 `AGENTS.md`。本地提交不隐含 push、PR、merge、tag 或 Release。
- 不为形式创建 controller/service/repository 空目录，不把业务规则塞进 route 注册、Fastify plugin 或 React 页面组合入口。
- 不依赖未声明的全局 Node 工具；项目命令必须通过 `pnpm` 使用本地依赖。
- 不把项目外绝对路径写入仓库文档、源码或错误消息。

## 6. 项目级例外

- BullMQ/Redis 是可选队列传递后端；任务、投递、事件和可审计状态仍以数据库模型为准。
- 开发模式可使用固定管理员和内存存储，但生产模式不得注册 dev 控制面或复用开发凭证。
- updater 的 Bash 测试允许使用受控命令替身验证 Docker 调用顺序；真实 Git transaction 仍必须在临时仓库运行，真实 Docker/网络验收另行执行。
