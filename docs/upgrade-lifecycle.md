# QingYan Upgrade Lifecycle Reserve

QingYan 当前尚无正式 release。本轮配置、安装、DB-owned site settings、system settings 和导入导出改造按 hard cut 执行，不提供旧状态兼容。

当前 hard cut 明确不做：

- 不迁移旧 `sites[].defaults` 配置。
- 不保留旧 `runtime_settings` 语义或表。
- 不保留旧 `/api/admin/settings` 管理接口。
- 不兼容旧未发布 QingYan export formatVersion 1。
- 不为本地开发旧 SQLite 数据提供自动升级保证。

这些选择只适用于未发布阶段。第一次正式 release 之后，类似破坏性变化必须进入明确 upgrade lifecycle。

## Future State Machine

未来启动前应先判断实例状态。release 后状态名固定为：

```text
not_installed
normal_current
upgrade_required
recovery_required
broken_config
```

状态检测应发生在完整业务 app 创建之前。install、upgrade 和 recovery 可以复用 minimal app 的部分能力，但 mode 必须清晰分开，避免已安装实例误入首装流程。

状态判定输入至少包括：

- startup config 是否存在、是否能通过 schema 校验，以及 env override 后的有效值。
- SQLite DB 文件是否存在，或未来 PostgreSQL/MySQL 连接是否可用。
- `__qingyan_migrations` schema migration ledger 是否存在、是否包含当前 release 要求的 migration。
- `__qingyan_upgrades` application upgrade ledger 是否存在、是否包含当前 release 要求的 application upgrade step。
- `admin_bootstrap_state` 是否存在有效 bootstrap row。
- `sites` 是否存在有效站点行。
- 是否存在未完成升级留下的备份、UpgradePlan 或 partial marker。

状态含义：

- `not_installed`：缺 startup config，或 config 指向的 DB 尚未初始化到可运行状态；只允许进入 install mode。
- `normal_current`：startup config 有效，schema migration ledger、application upgrade ledger、admin bootstrap 和 site rows 都满足当前 release 要求；进入完整业务 app。
- `upgrade_required`：startup config 有效，实例属于已发布旧版本，schema 或 application upgrade ledger 落后；只允许进入 upgrade mode 或 CLI upgrade。
- `recovery_required`：检测到 partial install、partial upgrade、备份/计划存在但 ledger 未完成，或 DB migration 与 application upgrade 状态不一致；进入 recovery，不继续启动业务 app。
- `broken_config`：startup config 存在但无法解析、校验失败，或 env override 产生不可恢复冲突；除非用户显式允许 recovery，否则不进入 install 或 upgrade。

install mode 只处理 `not_installed`。upgrade mode 只处理 `upgrade_required`。即使 Web upgrade mode 复用 minimal app 的 token、静态页面或表单能力，也必须使用独立路由和独立语义，不能复用 `/admin/install` 或安装 apply payload。

## Version Records

release 后至少需要两类版本记录。

`schema migrations`：

- 由现有 migration ledger 记录。
- 负责表、列、索引、约束。
- 适合自动执行的结构变更。

`application upgrades`：

- 需要新增 `__qingyan_upgrades` 或等价 ledger。
- 负责配置格式、settings owner、数据语义迁移和一次性修复。
- 每个 upgrade step 必须有名称、来源版本、目标版本、应用时间和 JSON 摘要。

可选地在 `system_settings` 保存当前 `stateVersion`，但具体 upgrade step 仍需要 ledger，不能只靠一个全局版本号。

## Upgrade Levels

### Level 0: Automatic Schema Migration

适用：

- 新增表。
- 新增可空列。
- 新增索引。
- 不改变现有业务语义。

行为：

- 启动时自动执行。
- 失败则启动失败。

### Level 1: Automatic Application Upgrade

适用：

- 幂等数据补齐。
- 不改配置文件。
- 不删除用户值。
- 不改变 secret 存储位置。

行为：

- 启动时自动执行。
- 写入 upgrade ledger。

### Level 2: Confirmed Upgrade

适用：

- 改写配置文件。
- 从 YAML 移动 owner 到 DB。
- secret 存储位置变化。
- 删除、合并或覆盖用户配置。
- 可能改变运行语义。

行为：

- 启动检测到后进入 `upgrade_required`。
- 必须提供 CLI dry-run/apply。
- 可选提供 token-protected Web upgrade mode。
- apply 前必须生成 `UpgradePlan` 并要求用户确认。

## UpgradePlan

未来升级器应先生成 `UpgradePlan`，再执行。计划至少包含：

- 当前版本和目标版本。
- 将执行的 schema migrations。
- 将执行的 application upgrades。
- 将修改的配置文件字段。
- 将写入或覆盖的 DB settings。
- secret 字段处理策略。
- 备份路径。
- 风险提示。

SQLite 场景下，confirmed upgrade 必须备份配置文件、数据库文件和 UpgradePlan。PostgreSQL/MySQL 后续支持后，DB 备份可以要求用户先完成外部备份，但 UpgradePlan 必须明确提示。

## Required Entrypoints

CLI 是 release 后必须提供的升级入口：

```text
qingyan upgrade --dry-run
qingyan upgrade --apply
qingyan upgrade --config config/qingyan.yml
```

Web upgrade mode 如果实现，必须满足：

- 只在 `upgrade_required` 状态开放。
- 使用一次性 token。
- 明确区别于 `/install`。
- 展示 UpgradePlan，而不是直接写配置或数据库。

## Recovery Rules

partial upgrade 应进入 recovery，而不是继续启动业务 app：

- 配置文件备份存在但 ledger 未完成：提示恢复或重试。
- DB migration 成功但 application upgrade 未完成：允许重试幂等步骤。
- secret 迁移中断：不显示明文，只提示重新输入或保留原来源。

## Current Scope

本文件只是 release-after 规则预留。本轮 hard cut 不实现：

- `stateVersion`
- 旧配置或旧数据库兼容

第一次正式 release 前，应重新评估是否需要把这些预留机制落入代码。

本轮已作为 release-after scaffolding 预留：

- `__qingyan_upgrades` application upgrade ledger。
- `UpgradePlan` 纯域模型和公开输出脱敏。
- 显式升级状态检测。
- `pnpm qingyan:upgrade -- --dry-run --config config/qingyan.yml`
- `pnpm qingyan:upgrade -- --apply --config config/qingyan.yml --backup-dir <dir>`

这些入口目前只处理未来 confirmed upgrade 的基础骨架，不提供旧未发布状态兼容。

## Release-cycle Migration Folding Checklist

第一次正式 release 前：

- 允许破坏性 DB/schema 调整。
- 将当前 schema 折叠进 `drizzle/0000_initial.sql`。
- 不为旧未发布 config、SQLite、export 或 runtime settings 提供兼容升级。
- 发布前确认 `drizzle/` 中没有零散临时 migration。

第一次正式 release 后：

- 不再修改已经随 release 发布过的 migration 文件。
- 从上一个 release 到下一个 release 之间的 DB 变更，默认折叠进同一个下一版本 migration 文件。
- 下一个 release 发布时冻结该 migration 文件。
- release 之后再出现 DB 变更，进入再下一个 migration 文件。

每次发布前至少检查：

- `pnpm run check` 通过。
- `drizzle/` 中 migration 文件数量和命名符合当前 release 周期。
- 已验证从上一正式 release 到当前 release 的 upgrade path。
- confirmed upgrade 需要备份 config、SQLite DB、WAL/SHM 和公开脱敏的 UpgradePlan。
- 只有 migration 文件冻结、upgrade path 验证完成后才打 tag。
