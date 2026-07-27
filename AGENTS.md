# QingYan 项目级协作规范

本文件只保留 `QingYan` 仓库特有约束；通用执行方式、提交边界、验证门禁和 skill 流程遵循全局规则。

## 产品设计门禁

- 仓库根目录 `PRODUCT.md` 是 QingYan 产品信息架构、交互、文案和保存语义的唯一产品设计规范；`AGENTS.md` 只保留开发过程与执行门禁，不重复维护产品规则。
- 新增、修改或评审任何 Admin UI、设置流程、用户提示、错误恢复或配置保存行为前，必须先完整阅读 `PRODUCT.md` 并按其中的产品合同执行。
- 改动如果引入新的页面类型、设置归属、保存模型、弹出层语义或跨页面依赖，必须在同一任务中同步更新 `PRODUCT.md`；不得只在代码、计划或会话中留下产品决策。

## 开发过程文档

`spec` 是阶段任务说明，用于描述目标、范围、边界和验收标准。`plan`
是基于 spec 编写的执行计划，用于拆分实现步骤、验证方式和交付顺序。

由 Superpowers skills 生成或驱动的 spec、plan、brainstorming 纪要、outline、
implementation plan、开发大纲等过程文档，不存放在项目仓库内；具体仓库外存放位置遵循全局
Agent 规则中的“文档与记忆”约定或用户当次指定路径。

仓库内 `docs/superpowers/` 属于历史漂移目录，不应再创建；若发现新的
Superpowers 过程文档出现在仓库内，应迁移到仓库外目录后删除仓库内副本。除非用户明确要求，
这些过程文档不进入 git 提交范围。

## 测试约束

- 禁止新增“读取仓库源码文件后，用正则或字符串包含关系断言实现细节”的测试。
- 典型禁用形式包括但不限于：
  - `readFile(...src/**/*.ts)` 后配合 `assert.match` / `assert.doesNotMatch`
  - 对 service、route、schema、repository、config 源码做关键字存在性断言
  - 用源码文本去间接证明某个 API 逻辑或后端行为成立
- `QingYan` 是纯 API / 后端仓库。验证优先级默认是：
  1. API 模拟访问 / `app.inject(...)` 集成测试
  2. 纯函数、service、repository 的输入输出测试
  3. 迁移、schema、配置的结构级断言
- 纯 API 后端默认不为了验证交互去补浏览器联调测试；只要 `app.inject(...)`、Vitest 集成测试或等价 API 级模拟已经能覆盖行为，就不额外上浏览器。
- 像 OpenAPI YAML、管理后台 HTML、日志输出这类“接口或渲染结果文本”可以测返回结果本身；禁止的是“去读源码文件再用正则断言”。
- 如果某项历史源码正则测试没有合理的 API / 逻辑级替代，应直接删除，不保留低价值实现细节测试。

## Git 分支与发布工作流

- `develop` 是本仓库的默认开发集成分支。后续常规改动默认在 `develop` 或从 `develop` 切出的子分支上进行，不直接在 `main` 上开展日常开发。
- 若当前任务使用子分支推进，默认流程是：从 `develop` 切出子分支 -> 完成改动 -> 先向 `develop` 发起 PR -> 在 `develop` 上做完整测试与集成验证。
- 正式发布流程默认是：`develop` 完成集成验证 -> 调整版本号 -> 向 `main` 发起发布 PR -> 合入 `main` 作为正式版。
- `main` 默认只承载正式版内容，不承担日常功能开发与长期集成职责。
- 例外规则：若 `main` 上的正式版在 GitHub Actions / CI / CD 中出现报错，可直接在 `main` 上进行热修复；修复完成后应保留修复记录，并删除为该热修复建立的临时分支（若有）。
- 凡是由本地工作流发起的 PR，默认直接同意，不额外等待人工批准。
- 任一 PR 同意并完成后，本地默认立即同步远端结果，并切回 `develop` 作为后续工作的待命分支。
- 非发布场景默认按 `子分支 -> develop` 收口；只有明确发布时才走 `develop -> main`。

## 数据库迁移与 release 规则

- 第一个正式 release 之前，数据库 schema 仍允许破坏性调整；可以直接重整 `0000_initial.sql`，不要求保留中间迁移历史。
- 第一个正式 release 之前，如果本次改动重整了 `0000_initial.sql`，且用户需要在已有测试/预发实例上更新代码，最终回复必须提供一个临时脚本或命令，用于在该测试环境补齐/升级现有数据库结构。
- 上述临时脚本或命令只服务未发布期测试环境迁移，不默认写入仓库、不作为正式 release 迁移文件；涉及真实线上数据时必须提醒先备份，并由用户确认执行窗口。
- 第一个正式 release 之后，不再直接修改已经发布过的迁移文件；后续数据库变更必须进入新的版本升级迁移。
- 从某个 release 到下一次 release 之间，即使经过多轮任务、多次 schema 调整，也默认折叠到同一个下一版本迁移文件中，例如 `0002_*.sql`。
- 下一次 release 发布前，应整理该版本周期内的数据库改动，减少碎片化迁移文件，避免一次版本升级包含十几个临时 SQL。
- 发布完成后，该版本迁移文件视为冻结；之后再有数据库变更，进入再下一个迁移文件。
- 这条规则是为了降低后续 upgrade 复杂度；若与工具自动生成行为冲突，优先按本规则人工整理迁移文件。

### Upgrade lifecycle 规则

- 第一次正式 release 前，本仓库仍按 hard cut 处理未发布状态，不提供旧 `qingyan.yml`、旧 `runtime_settings`、旧管理接口或旧 export 格式兼容。
- 第一次正式 release 后，破坏性配置、settings owner、secret 存储位置、数据语义或 schema 变化必须进入明确 upgrade lifecycle。
- release 后升级状态至少区分：`not_installed`、`normal_current`、`upgrade_required`、`recovery_required`、`broken_config`。
- install mode 只处理 `not_installed`；upgrade mode 只处理 `upgrade_required`。即使复用 minimal app 能力，也不能把 Web upgrade 复用成 `/admin/install` 语义。
- confirmed upgrade 必须先生成公开脱敏的 `UpgradePlan`，再执行；计划至少说明 schema migrations、application upgrades、配置改动、DB settings 改动、secret 处理、备份路径和风险。
- confirmed upgrade 写入前必须备份 startup config、SQLite DB、WAL/SHM 和 UpgradePlan；未来 PostgreSQL/MySQL 场景可要求用户先做外部 DB 备份，但 UpgradePlan 必须明确提示。
- application upgrade 需要使用 `__qingyan_upgrades` 或等价 ledger 记录 step 名称、来源版本、目标版本、应用时间和 JSON 摘要。
