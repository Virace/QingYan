# QingYan 项目级协作规范

本文件用于补充 `QingYan` 仓库内的项目级执行约束；若与通用 skill 或默认流程冲突，以本文件和当前用户明确要求为准。

## 开发过程文档

开发过程文档默认保存在仓库外：

```text
E:\Project\Docs\Web\QingYan
```

仓库内 `docs/superpowers/` 属于历史漂移目录，不应再创建；若发现该目录或新的 spec / plan / outline 文件出现在仓库内，应迁移到上面的仓库外目录后删除仓库内副本。

以下内容默认视为执行过程产物，不进入 git 提交范围，除非用户明确要求：

- `docs/superpowers/plans/` 下的所有文档
- `docs/superpowers/specs/` 下的设计 / spec 文档
- `E:\Project\Docs\Web\QingYan\superpowers\plans\` 下的所有文档
- `E:\Project\Docs\Web\QingYan\superpowers\specs\` 下的设计 / spec 文档
- 任何 task plan、outline、brainstorming 纪要、implementation plan、开发大纲类文档

处理原则：

1. 可以为了执行在本地创建或修改这些文档
2. 新建时优先写入仓库外文档目录，不写入仓库内 `docs/superpowers/`
3. 如果某个 skill 默认要求“写 spec 并提交”，在本仓库中一律以本规则覆盖
4. 默认不 `git add`，不提交，不混入功能提交

## 提交时机

在一个任务尚未完成前，禁止为了“阶段性保存”“流程要求”或“先落 spec”而创建任何提交。

默认提交规则：

1. 任务进行中不提交
2. 任务完成前不提交
3. 即使任务完成，也只有在用户明确要求提交时才允许提交
4. 若中途误创建提交，应优先撤销到工作区后继续推进

## 纯文本变更验证

当改动只涉及纯文本文件时，不要求执行自动化测试，除非用户明确要求。

纯文本文件包括但不限于：

- `.md`
- `.txt`
- 纯文案说明
- 项目规范类文本

这类改动的默认验证方式是：

1. 人工校对内容
2. 检查格式、语义和范围是否正确
3. 仅在文本本身会直接影响程序解析时，才补做对应验证

## 提交说明例外

当提交只包含纯文本改动时，提交信息正文可以省略 `Test:` 段。

处理原则：

1. 代码、配置、脚本、数据库和行为变更，仍优先保留验证说明
2. 纯文本提交可只写 `Why:` 和 `What:`
3. 若用户明确要求更简短的提交信息，以用户要求为准

## 执行偏好

- 设计、计划、spec 文档默认只服务当前执行，不作为仓库交付物
- 若需要记录长期有效的仓库规则，应优先写入 `AGENTS.project.md` 或用户明确指定的规范文件
- 完成实现时，优先交付代码、测试与必要文档更新，而不是开发过程文档

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
