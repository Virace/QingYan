# SQLite 到 PostgreSQL 离线转换与切换

本流程面向已发布 `0.2.5` SQLite 实例的一次性停写转换。当前程序仅运行 PostgreSQL；普通启动和 `qyctl upgrade` 识别旧配置后交接到本工具，不在原库执行新的 PG SQL。更早 SQLite 实例先用对应旧版升级到已审查的 `0.2.5` 结构。正式服务器执行前，先固定目标程序版本、数据库服务/账号、停止写入方式、资源映射、预计窗口、核对与回滚责任，并由用户确认具体切换方案。

## 工具与边界

- 开发入口：`pnpm db:convert <操作>`。
- 构建入口：`node dist/modules/database-conversion/main.js <操作>`，运行镜像也含此入口。
- 操作：`analyze`、`convert`、`verify`、`apply-config`；`--help` 展示当前准确参数。
- URL 只从 `QINGYAN_DATABASE_URL` 读取，也可 `--database-url-env <变量名>` 指定受保护环境变量；不在命令行传连接 URL。Node 24、PostgreSQL 18 与客户端版本按部署文档准备。
- `convert` 以空目标库为边界。失败目标保留未完成账本并阻止 normal 启动；重试使用新的空目标，不向失败目标反复合并。
- `convert` 只生成 `target-config.yml`，不覆盖真实旧配置。配置切换是单独操作，执行前再次核对目标库和输出报告。

## 预演与正式窗口

预演使用从停写实例获得的独立一致快照、匹配配置和必要资源，原始源文件保持只读。源 SQLite Backup API 独立快照是恢复主文件，WAL/SHM 只作现场诊断归档；不可只复制正在写入的主文件。转换工具会归档完整源库、结构指纹、表/字段去向与核对结果，退出活跃模型的六张历史表仍可从归档读取。

本地已完成的样本预演不代替服务器窗口。服务器路径、环境引用与 IP 库实体必须在正式环境重新核对；不要把本地目标 URL、配置或预演转换产物当作正式结果复制到服务器。

正式窗口须停止公开 API、Admin、scheduler/worker、自动清理与运维写入，等待在途任务与发送收敛。保留旧程序版本、旧配置、安装锁、一致 SQLite 快照、必要资源和待发任务事实。数据库事务不能撤回已发送邮件或 webhook，无法确认发送结果的项目应先核对。

## 分析、转换与核对

下面是 Linux/容器部署示例的命令形态；路径与目标库需在确认方案中替换。先由运维创建全新 PostgreSQL 数据库及角色，并通过受保护环境注入目标连接。`--output` 对分析、正式转换分别使用新的目录。

```bash
node dist/modules/database-conversion/main.js analyze \
  --source /migration/source/qingyan.db --output /migration/analysis

node dist/modules/database-conversion/main.js convert \
  --source /migration/source/qingyan.db --config /migration/source/config/qingyan.yml \
  --output /migration/conversion --source-stopped \
  --source-root /migration/source --source-runtime-root /app

node dist/modules/database-conversion/main.js verify --output /migration/conversion
```

`--source-root` 是宿主实例根目录，`--source-runtime-root` 是旧容器看到的对应根（例如 `/app`），用于显式把 `/app/data/...` 映射到已冻结的资源实体。直接部署按真实根映射，不猜路径。必要 IP 文件缺失会使 `configurationSwitchReady` 为 false；应备齐合法源资源后，从同一冻结源重新转换到新空目标和新输出目录，再核对与切换。报告校验和受完成账本约束，不得编辑 manifest 或配置摘要绕过。

`verify` 会重新打开归档和目标 PG，逐表逐字段核对内容、关联、账本匹配与报告校验和，并核对源/目标配置、`configuration.json` 内容及已归档资源的校验和。行数相同不能替代内容核对。已有评论 ID、正文/HTML、作者、父子关系、UTC 时间、累计量、凭据 hash、权限、通知已接受结果、任务幂等与有效配置保持；退役导入历史、backup 计划/快照及相关运行历史、独立 IP 更新历史完整归档。访客、访问与指标未新增删除期限。

真实样本兼容验证使用现有测试入口，并设置 `QINGYAN_CONVERSION_SOURCE_SQLITE`、`QINGYAN_CONVERSION_SOURCE_CONFIG` 和隔离 `QINGYAN_TEST_DATABASE_URL`；样本和凭据不入仓库。

## 配置切换与验收

确认 report、资源完整性、source fingerprint、目标版本和 target identity。保留旧配置的 SHA-256 后，使用明确目标：

```bash
node dist/modules/database-conversion/main.js apply-config \
  --output /migration/conversion --destination /instance/config/qingyan.yml \
  --expected-config-checksum <旧配置SHA256>
```

工具先重新 verify、检查资源和目标配置未变化，保存 `previous-config.yml`，再在同目录原子替换配置。如果配置已替换而 marker 收尾中断，可携带原 `--expected-config-checksum` 重跑同一 `apply-config`；工具会核对前一配置和目标事实后完成收尾，不重复覆盖。切换前核对部署环境变量：`QINGYAN_DATABASE_URL` 的环境覆盖必须指向同一正式目标，不能继续使用本地预演库或旧值。输出与归档含密钥和用户内容，访问权限按完整备份管理。

以新程序连接目标后，检查 `normal_current`、管理员登录和 ACL、评论公开/管理读取、站点设置、代表性写入、任务与通知状态、IP 当前库及最近检查。验证环境发送走受控 adapter；正式恢复调度前核对待发任务、停机期间 nextRunAt/cron/missed-run 与旧 worker lease。确认旧 worker 退出后再处理过期 lease，避免集中重复发送。

保存最终 source/target fingerprint、逐表字段核对、归档清单、版本、路径映射、耗时、峰值内存、目标大小和切换时点。备份可恢复性必须在独立空目标实际 `pg_restore` 并配套启动验证，命令见 [部署指南](deployment.md#备份与恢复)。

## 回滚

新库尚未接收真实写入时，停新程序，恢复旧程序、旧配置及同一冻结时点的 SQLite 和资源，再恢复原 worker。恢复快照使用干净目标位置，避免混入其他 WAL/SHM。

新库已接收写入后，先停写并保留新库，优先修复新程序。直接退回旧库会遗漏新评论、配置及发送结果；确需回退时，先核对新增数据回迁，或由用户确认明确的数据窗口。旧库、配置、转换归档与备份都保留到验收和回滚窗口结束。
