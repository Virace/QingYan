# QingYan 项目开发规范

## 1. 适用范围与权威来源

本规范适用于仓库根目录下的服务端、Admin Console、运维脚本、数据库迁移、测试和项目文档。

规则优先级如下：

1. 当前任务中用户明确确认的目标与边界。
2. `AGENTS.md` 的项目硬门禁。
3. `PRODUCT.md` 的产品信息架构、交互、文案与保存语义。
4. `PROJECT_CONSTRAINTS.md` 的技术、安全、部署和兼容边界。
5. `PROJECT_DESIGN.md` 的当前结构与数据流。
6. 本文件的日常编码、命名和验证规范。

涉及公开 API 时，以 `docs/openapi.yaml`、实际路由行为和对应契约测试共同作为当前证据；三者不一致时不得只改文档或只改实现后宣称兼容。涉及 Admin Console 产品行为时必须先完整读取 `PRODUCT.md`。

## 2. 技术栈与真实命令

### 技术基线

- Node.js `>=24.0.0`，包管理器为 `pnpm@10.33.0`，锁文件为 `pnpm-lock.yaml`。
- 服务端为 Fastify 5 + TypeScript 6 + Zod 4 + Drizzle ORM，运行时数据库为 SQLite。
- 服务端编译目标为 ES2022，`NodeNext` 解析；仓库未声明 ESM package，`dist/` 服务端输出为 CommonJS。
- Admin Console 为 React 19 + Vite 8 + Tailwind CSS 4；Admin TypeScript 使用 Bundler 模块解析，构建产物写入 `dist/admin`。
- Vitest 4 覆盖单元、API、仓储、迁移和 CLI 行为；Playwright 1.60 负责 Admin Chromium 系统流程。
- Biome 2.4 负责格式和静态检查，`biome.json` 显式启用 Tailwind 指令解析。

### 安装与开发

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:api
pnpm dev:admin
```

### 格式、静态检查与类型检查

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck:server
pnpm typecheck:admin
pnpm typecheck
```

`pnpm typecheck` 必须同时覆盖服务端、脚本、Vitest 测试和 Admin Console。只运行一个目标的命令是开发期定向检查，不能替代交付前的完整类型检查。

### 测试与构建

```bash
pnpm test
pnpm test -- tests/unit/public-path.test.ts
pnpm test:smoke
pnpm test:e2e
pnpm test:system
pnpm test:updater
pnpm test:updater:real-git
pnpm build
pnpm config:check
pnpm check
pnpm check:system
```

- `pnpm test` 运行 `tests/**/*.test.ts`。Vitest 的额外位置参数用于按路径定向过滤。
- `pnpm test:smoke` 使用临时 SQLite，通过 Fastify 注入完成验证码、评论、审核和读取的核心链路。
- `pnpm test:e2e` 启动本地 API 与 Admin Vite 服务，运行 Chromium 流程。
- `pnpm test:system` 串行运行 API/SQLite 冒烟与 Admin E2E。
- `pnpm test:updater` 与 `pnpm test:updater:real-git` 需要 Bash；后者还会在临时目录创建真实 Git 仓库。两者不访问真实部署。
- `pnpm test:smoke:commenter-email` 会使用已保存配置和真实邮件链路，只在明确准备好测试实例、收件地址和 SMTP 后手动运行，不进入默认门禁。
- `pnpm check` 是默认交付门禁：格式、lint、完整类型检查、Vitest、构建和示例配置校验。
- `pnpm check:system` 在默认交付门禁后继续运行系统测试；涉及 Admin 关键流程、启动链路或系统测试基础设施时使用。

## 3. 代码组织

- `src/app.ts` 是正常运行模式下 Fastify 插件和路由的组合入口；`src/server.ts` 只负责 install、upgrade、normal 启动模式及进程生命周期。
- `src/config/` 负责 startup config、环境变量映射与运行时选项；不把 DB-owned settings 重新塞回 startup config。
- `src/db/` 负责客户端、迁移执行和 schema 导出；`drizzle/` 是受版本控制的数据库迁移资产，不是生成缓存。
- `src/modules/<capability>/` 按稳定业务能力拥有 route、service、repository、schema 或 presenter。只有多个相关模块形成明确所有权、公开表面或测试边界时才继续分目录。
- `src/plugins/` 只做 Fastify 生命周期和横切能力装配；业务规则留在对应 module。
- `apps/admin/` 是随服务端发布的 Admin SPA；API 访问集中在 `apps/admin/src/api/`，产品页面按业务工作流组织。
- `scripts/` 是开发、升级、回填和迁移入口；可复用业务逻辑仍放在 `src/`，脚本只负责编排和命令行边界。
- `tests/` 按最低有效证据组织；公共 fixture 放 `tests/support/`，不得为单个测试复制一套并行基础设施。

依赖方向原则为：route/CLI/script 调用 service 或明确的业务函数，service 调用 repository/adapter，repository 访问 Drizzle/SQLite。组合入口负责依赖注入；底层模块不反向导入页面、route 注册或进程入口。

## 4. 命名与文档

- 变量、函数和实例使用 `camelCase`；类型、接口、类和 React 组件使用 `PascalCase`；模块级常量使用 `UPPER_SNAKE_CASE`。
- 手写文件默认使用 `kebab-case.ts` / `kebab-case.tsx`。保留 React 既有入口 `App.tsx`，不为形式统一制造无价值重命名。
- 包脚本的通用质量动作使用 `action[:target]`，例如 `typecheck:admin`、`test:e2e`、`build:admin`；领域运维命令可使用 `domain:action`，例如 `db:migrate`。
- 名称应表达领域角色或输出用途。避免脱离很小作用域仍使用 `data`、`result`、`item`、`raw`、`out`、`ts`、`rl` 等无法判断含义的名字。
- `id`、`db`、`ip`、`url`、`api`、`ui`、`smtp`、`json`、`html`、`wxr` 等项目内稳定缩写可在上下文清楚时使用；数值单位写入名称，如 `timeoutMs`、`retryDelaySec`、`maxBytes`。
- 布尔值优先使用 `is`、`has`、`can`、`should`、`enabled` 等能读出真假语义的名称。
- TypeScript 内部模型使用 `camelCase`。SQL 列、环境变量、第三方 payload 和已发布 JSON 字段属于外部合同，保留各自命名并在边界显式映射，禁止为内部整齐静默改写合同。
- 注释只解释公共合同、原因、不变量、生命周期、安全边界或不明显的运行时差异；不逐行复述代码，不记录修改过程，不保留失效说明。
- 修改脚本、公开接口、配置键或工作流时，同步检索并更新 README、`docs/` 和项目标准中的直接引用。

## 5. 错误与日志

- API 的机器消费者依赖 HTTP 状态与稳定错误码；错误码使用大写下划线形式并通过 `AppError` 或等价边界产生。
- API 用户消息必须简短、可执行且不泄露内部实现。响应可携带 `requestId`；校验错误只返回允许公开的字段级信息。
- 未处理异常统一转换为 `INTERNAL_ERROR`，原始异常、堆栈、数据库信息、连接信息和 secret 只进入受保护的内部日志。
- `src/logging/` 负责 access/app 双通道、文本/JSONL 格式和敏感字段脱敏。日志事件名是运维诊断合同，修改时必须更新对应行为测试。
- Admin Console 不直接渲染后端原始 message、字段 path、队列/worker/route 或内部 ID；按稳定错误码映射为符合 `PRODUCT.md` 的场景化恢复提示。
- 外部服务失败需保留可分类的内部原因，同时对调用者提供稳定、安全的错误表示；不得把服务商原始响应直接透传给终端用户。

## 6. 变更门禁

### 日常门禁

- 修改过程中实时纠正本轮新增或直接涉及的命名、route 归属、包路径和文档引用；不得借机做无关全仓库整理。
- 服务端、脚本、测试或 Admin 代码改动至少运行相应定向测试、目标类型检查和 lint/format check。
- 公开 API、schema、settings owner、secret、数据库或 upgrade lifecycle 变更必须遵守 `AGENTS.md` 的 SPEC、迁移与发布门禁。
- Admin UI、设置、提示、错误恢复或保存模型变更必须按 `PRODUCT.md` 验收；API 级证据不能替代必要的浏览器或人工视觉确认。
- 交付前默认运行 `pnpm check`；系统关键路径改动运行 `pnpm check:system`。Bash updater 变更另跑两个 updater 测试。

### 测试策略

测试目标是防止公开评论合同、权限/安全边界、SQLite 状态迁移、任务/通知可靠性、升级恢复和 Admin 关键工作流回归；不追求用多层测试重复同一矩阵。

#### 风险与证据

| 风险或稳定合同 | 可观察行为 | 最低有效证据 | 环境或依赖 | 主要位置 | 执行时机 |
| --- | --- | --- | --- | --- | --- |
| 公开评论与页面反馈 API 漂移 | `app.inject(...)` 返回的状态、结构、功能开关和 OpenAPI 一致 | API 集成与契约测试 | 临时 SQLite、Fastify | `tests/integration/` | 修改公开 route/schema/presenter 时 |
| 登录、ACL、限流、Origin、CSRF 或 request ID 失效 | 不同身份和输入得到稳定允许/拒绝结果及安全错误 | API/安全集成测试 | 临时 SQLite、注入请求 | `tests/security/`、`tests/integration/` | 修改安全或管理 API 时 |
| schema、迁移、备份、install/upgrade 恢复错误 | 真实 SQLite/文件状态可升级、回滚或保留恢复标记 | 仓储与集成测试 | 临时 SQLite 和目录 | `tests/repository/`、`tests/integration/upgrade-*` | 修改持久化或生命周期时 |
| 任务、通知、锁和重试状态错误 | task run、delivery、event log 与幂等/锁状态符合合同 | 业务/仓储/API 测试 | 临时 SQLite；真实 Redis 仅在显式环境运行 | `tests/tasks/`、通知相关测试 | 修改任务或通知时 |
| Admin 关键操作流断裂 | Chromium 中登录、设置、保存、错误恢复、主题和弹层可完成 | Playwright 系统测试 | 本地 API、Vite、Chromium | `tests/e2e/` | 修改关键 Admin 流程或交付前系统门禁 |
| Docker Compose updater 破坏本地状态或失败回滚 | 命令顺序、stash 恢复、真实 Git transaction 符合预期 | Bash 系统脚本测试 | Bash、Git；Docker 使用受控替身 | `tests/scripts/` | 修改 `scripts/update.sh` 时 |

#### 编写顺序与质量边界

- 可复现 Bug、权限规则、状态迁移、解析器和幂等合同优先先写失败测试，再做最小修复。
- 未知第三方行为或尚未稳定的跨组件探索先定义验收场景；纵向链路稳定后再固化自动化。
- 每个持久测试必须能说明哪类真实生产改动会让它失败。优先扩展现有 fixture 或参数矩阵，不复制同一行为到多个层级。
- 只 mock 慢或外部边界；事务、迁移、锁、序列化和文件恢复风险必须使用真实 SQLite/文件/Git 语义。
- 禁止读取仓库实现源码后用字符串或正则断言关键词存在。允许断言真实生成的 OpenAPI、HTML、日志、备份或导出产物。
- 不为纯文案、注释、格式、私有重命名、文件移动或装饰性 UI 新增自动化测试；使用目标 diff、静态检查和必要人工验收。

#### 环境与人工边界

- `QINGYAN_BULLMQ_REDIS_URL` 未提供时，真实 Redis 集成用例会跳过；默认 Vitest 通过不代表 Redis 语义已验证。
- 真实 SMTP、Webhook/WxPusher、收件箱到达、退信、生产代理/WAF、Docker 镜像网络和真实服务器升级必须在相应环境人工或专项验收。
- Playwright 能证明已编码场景，不替代 Admin 的整体视觉密度、长文案、窄屏和未知数据组合的人工检查。

## 7. 项目例外

- QingYan 是 API-first 服务，但同仓库包含随服务端发布的 Admin SPA。纯 API 行为优先使用 `app.inject(...)`；只有浏览器交互、布局、路由或前端运行时风险才使用 Playwright。
- 服务端保留 CommonJS 构建输出以匹配当前 `package.json` 与 Node 启动方式；Admin 继续使用 Vite ES modules。修改模块制度必须作为兼容性变更单独评估。
- `skipLibCheck: true` 用于隔离第三方声明文件，不允许用它掩盖项目源码类型错误。
- SQLite 是当前唯一正式数据库合同；BullMQ/Redis 只替换队列传递边界，不改变 task/delivery 持久状态模型。
- 项目已经进入 release 后 upgrade lifecycle。已发布迁移不得重写；同一待发布版本的迁移整理遵循 `AGENTS.md`。
