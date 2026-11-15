# 1Panel 受限 API 网关

网关只为已配置的内部接入方中转明确允许的 1Panel API。QingYan 的日志关联、封禁策略、受管规则台账和恢复任务属于应用安全模块。网关不代理网站流量，不占用 80/443，不读写 1Panel 的配置或内部数据库。

## 运行与配置

网关使用 Node.js 24 原生 TypeScript 运行，不安装第三方依赖：

```bash
docker build -t qingyan-onepanel-gateway:local services/onepanel-gateway
```

仓库 Compose 的服务名为 `onepanel-gateway`，使用 `onepanel` profile。只有配置真实上游、白名单和 secret 后才启用；未配置时不启动网关，QingYan 的 WAF 同步保持关闭。

文件与容器内位置：

| 文件 | 容器内位置 | 访问方 |
| --- | --- | --- |
| `gateway/allowlist.json` | `/app/config/gateway.json` | 网关，只读 |
| `gateway/secrets/onepanel-api-key` | `/run/secrets/onepanel-api-key` | 网关，只读 |
| `gateway/client/qingyan-gateway-token` | `/run/qingyan-gateway/qingyan-gateway-token` | 网关与 QingYan，只读 |

从 `services/onepanel-gateway/allowlist.example.json` 创建配置。1Panel Key 与内部 token 分开生成，文件建议归 root 所有、权限为 600。不要把真实文件提交到仓库。容器进程使用 UID 0 读取 root 专用文件，同时启用只读根文件系统、移除 capabilities 和 `no-new-privileges`；它不挂载 Docker socket 或任何面板内部目录。

网关环境变量 `QINGYAN_GATEWAY_CONFIG_PATH` 指定 JSON 文件，默认 `/app/config/gateway.json`。配置启动时校验，错误或无法读取 secret 时停止启动；修改后重建容器生效，不提供在线修改入口。

QingYan 使用 `http://onepanel-gateway:4402` 和独立内部 token。内部请求携带 `Authorization: Bearer <内部 token>`。`GET /healthz` 只表示网关已加载配置并监听，不代表 1Panel/WAF 可用。实际连通性通过白名单内的官方接口检查。

## 网络与面板来源白名单

Compose 只把网关连接到专用 `panel-gateway` bridge，不发布宿主机端口。默认配置如下，部署前必须核对与已有 Docker、Hyper-V、VPN 和宿主路由的冲突：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `QINGYAN_GATEWAY_SUBNET` | `172.30.251.0/28` | 专用容器子网 |
| `QINGYAN_GATEWAY_HOST_IP` | `172.30.251.1` | bridge 宿主地址 |
| `QINGYAN_GATEWAY_IP` | `172.30.251.3` | 网关容器静态源地址 |
| `QINGYAN_GATEWAY_IMAGE` | `qingyan-onepanel-gateway:local` | 对应应用版本的网关镜像 |

`upstreamBaseUrl` 必须是固定 HTTP(S) origin，例如 `http://172.30.251.1:9999`；禁止用户名、密码、路径、query 或片段。地址和端口以实际面板配置为准，配置中不会自动跟随任意 URL。`upstreamNode` 固定目标节点，默认 `local`。

面板 Key 的来源白名单只加入网关的静态 IP，不放行整个 Docker 子网。核对实际到达面板的源地址后再启用。静态 IP 与本地 API 白名单共同限制调用能力；面板 Key 本身仍具有官方配置的管理员权限。

## API 白名单合同

每条 `routes` 声明唯一 `id`、精确 `method`、规范 `path`、`purpose`，以及必要的 `query` 和 JSON `body` 约束。每个 `clients` 声明独立 token 文件和 `allowedRouteIds`。未配置的接口、未授予当前接入方的 route、未列出的参数都拒绝。

- 方法和路径同时精确匹配。不接受编码路径、点段、重复斜线、绝对 URL 或额外尾斜线，以保证判权与实际转发使用同一规范路径。
- query 默认禁止；配置后仍拒绝未知字段和重复字段。数字及布尔 query 使用明确值语义，转发保留原 query。
- body 默认禁止；启用时只接受 JSON。`object` 的 `fields` 是允许的完整字段清单，`required` 声明必需字段；嵌套对象同样不接受未知字段。
- 参数类型支持 `string`（固定 `values`、长度、前缀、`format: ip/name`）、`integer`（`min/max`）、`boolean`（可固定值）、`array`（`items/minItems/maxItems`）和 `object`。部署者用固定站点、受管名称与单一 IP 条件限制权限；处罚期限和复犯策略属于 QingYan。
- 目标节点由 `upstreamNode` 固定。调用方的 `CurrentNode`、官方签名、转发目标或方法覆盖头被拒绝；浏览器 Cookie 和内部 Authorization 不传给面板。
- 官方签名由网关按秒级时间戳生成：`HMAC-SHA256(API-Key, '1panel:' + timestamp)`，使用 `1Panel-Token`、`1Panel-Timestamp` 请求头。没有通用签名或任意 URL 中转接口。
- 不跟随上游 3xx。合法上游响应保留 HTTP 状态与正文，只保留响应内容类型和重试时间等必要头；Cookie 和签名头不返回调用方。传输失败、超时及跳转返回稳定网关错误码，不返回底层异常。

示例包含已在 1Panel v2.5.1 stable 核实的接口：

| 方法与路径 | 已知语义 |
| --- | --- |
| `GET /api/v2/core/settings/search/available` | API 鉴权及连通性检查 |
| `GET /api/v2/core/settings/upgrade` | 可用发布版本信息，不能当作当前安装版本 |
| `GET /api/v2/xpack/waf/status` | WAF/OpenResty 状态 |
| `GET /api/v2/xpack/waf/websites` | 核对站点 ID、alias 和 primaryDomain |
| `POST /api/v2/xpack/waf/log/search` | 用 `websiteKey`（alias）、`action: all`、空 `execRules` 分页，返回 `{total,items}` |
| `POST /api/v2/xpack/waf/rule/acl/search` | 用 `websiteID` 和受管名称查询站点 ACL |
| `POST /api/v2/xpack/waf/rule/acl/create` | 创建该站点的单一 IP 拒绝规则 |
| `POST /api/v2/xpack/waf/rule/acl/update` | 明确恢复同步后重新应用受管规则 |
| `POST /api/v2/xpack/waf/rule/acl/delete` | 按 `websiteID` 和受管名称解除规则 |

部署前必须把示例中的所有 `websiteID` 固定值与 `YOUR_WEBSITE_ALIAS` 改为目标站点。多站点按实际批准范围列出 ID 和 alias；QingYan 还会核对配置中的对应关系与日志 Host。IP 规则和 IP 组接口属于全局范围，不用于站点处罚，也未在示例开放。

写入只接受 `qingyan-` 名称、`state: on`、单项 `IP eq` 条件、`action: deny`、`code: 403` 和 `ipBlock: off`，避免提升成全局 IP 拦截。`expireTime: 24`、`unit: h` 只是面板 ACL payload 的固定字段，不能证明 deny 规则具有原生 TTL。QingYan 保存绝对到期时间并负责删除；停机期间到期解除会延后。面板写入和实际访问结果之间存在配置生效延迟。

## QingYan 同步配置与恢复

应用侧配置与网关 profile 分开启用：

| 环境变量 | 用途 |
| --- | --- |
| `QINGYAN_WAF_ENABLED=true` | 加载应用 WAF 能力 |
| `QINGYAN_WAF_GATEWAY_URL` | 内部网关地址，Compose 中为 `http://onepanel-gateway:4402` |
| `QINGYAN_WAF_GATEWAY_TOKEN_FILE` | QingYan 内部 token 文件 |
| `QINGYAN_WAF_MAPPING_FILE` | 站点映射 JSON，默认 `/app/config/waf-sites.json` |
| `QINGYAN_WAF_SYNC_PAUSED=true` | 维护时暂停面板请求、日志采集和同步任务 |

参考 `config/waf-sites.example.json`，填写 QingYan `siteKey`、面板 `websiteId`、`websiteKey`（alias）和允许的 `hosts`。`autoBanScans` 控制已知扫描事件自动处罚，默认关闭；`collectUnknownHosts` 默认关闭，启用后未映射日志只作为实例证据，不触发站点处罚。若启用未知 Host 采集，网关日志接口的 `websiteKey` 枚举还需明确允许 `unknown`。

站点设置还需显式开启“同步到面板访问防护”，才会提升新的有依据处罚；关闭该开关不停止已有受管规则到期与解除。共用 IP 默认转人工确认，明确恢复同步时会提示整站影响。

处罚与同步意图在同一数据库事务写入。同步通过任务中心执行，按站点串行；启动时补齐、每五分钟核对，重试沿用原到期时间，不重新计算。上游超时先查询实际规则，防止成功写入被当作失败后重复创建。规则名称和字段指纹用于核对受管对象；1Panel 人工删除或修改后暂停自动覆盖，后台显示差异，明确恢复才应用当前本地决定。手工解除本地时若已有面板差异，面板状态保留等待确认。

维护前设置 `QINGYAN_WAF_SYNC_PAUSED=true` 并重建应用容器；QingYan 继续记录本地决定，但不操作面板。维护结束取消暂停并重建，启动核对补齐结果。后台“安全规则 > 黑名单”分别展示本地限制和面板规则状态；“规则已配置”表示 API 已核对规则存在，实际请求需另行检查。

日志按源 ID 递增水位、分页重叠和稳定哈希去重。事件时间必须带 UTC offset；原始 Nginx 请求和 URI 查询参数不持久化。只有同站点、同 IP 且时间接近的唯一评论才标记低置信关联，不把该关联当作处罚原因。缺少时区、读取上限或源日志重置/保留缺口会保留提示；未采集到事件不能证明没有访问。默认本地证据保留 90 天，处罚历史至少保留到复犯窗口结束；未确认面板解除或存在人工差异的记录继续保留。

## 验证

```bash
pnpm exec vitest run --config vitest.config.ts tests/unit/onepanel-gateway.test.ts
```

本地 HTTP 测试观察真实网关请求与独立上游服务：覆盖签名、原始正文、响应、权限、参数、路径绕过、节点与目标头覆盖、上游跳转和超时。Docker 构建、静态来源地址、服务名解析及面板真实 API 需要在隔离 Compose 中另行验收；这些不能由本地上游替身证明。

参考：[1Panel 官方 API 鉴权文档](https://github.com/1Panel-dev/docs/blob/zh-CN/deploy/v2/dev_manual/api_manual/index.html)。
