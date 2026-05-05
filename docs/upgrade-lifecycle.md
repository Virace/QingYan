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

未来启动前应先判断实例状态：

```text
not_installed -> install -> normal
normal_current -> normal
normal_old_version -> upgrade_required -> normal
broken_config -> recovery
partial_install -> recovery
partial_upgrade -> recovery
```

状态检测应发生在完整业务 app 创建之前。install、upgrade 和 recovery 可以复用 minimal app 的部分能力，但 mode 必须清晰分开，避免已安装实例误入首装流程。

## Version Records

release 后至少需要两类版本记录。

`schema migrations`：

- 由现有 migration ledger 记录。
- 负责表、列、索引、约束。
- 适合自动执行的结构变更。

`application upgrades`：

- 需要新增 `__qingyan_upgrades` 或等价 ledger。
- 负责配置格式、settings owner、数据语义迁移和一次性修复。
- 每个 upgrade step 必须有名称、来源版本、目标版本、应用时间和摘要。

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
- `__qingyan_upgrades`
- `/upgrade`
- `qingyan upgrade`
- 旧配置或旧数据库兼容

第一次正式 release 前，应重新评估是否需要把这些预留机制落入代码。
