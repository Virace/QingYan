# Admin Console Web API

本文档记录 QingYan 自带 Admin Console Web 当前使用的 `/api/admin/*` 接口，供开发者调试、扩展内置后台或排查前后端调用时查询。

这些接口不进入公开 `docs/openapi.yaml`，也不作为第三方内容站点前端的稳定公共合同维护。它们不是禁止使用的接口，但主要服务内置 Admin Console，可能随后台页面、组件和数据模型一起调整；第三方站点前端不建议直接依赖这些路径或响应结构。

## 通用约定

- Base URL 与服务部署地址一致，例如本地开发默认 `http://localhost:4401`。
- Admin Console Web 使用 same-origin fetch，请求默认携带 cookie：`credentials: "include"`。
- 除 WordPress WXR 上传分析接口外，请求体和响应体默认是 JSON。
- 已登录接口使用后台会话 cookie，默认 cookie 名由 `admin.session.cookieName` 配置决定，示例为 `qingyan_admin`。
- 登录验证码是内置图片验证码，当前后台登录接口接受 `challengeId` 和 `captchaValue`。
- 错误响应沿用全局错误结构：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "错误说明",
    "requestId": "可选请求 ID",
    "details": {}
  }
}
```

前端类型来源：

- `apps/admin/src/api/session.ts`
- `apps/admin/src/api/overview.ts`
- `apps/admin/src/api/admin.ts`
- `apps/admin/src/api/import-export.ts`
- `apps/admin/src/api/ops.ts`

## Session

### `GET /api/admin/session/captcha`

获取后台登录验证码。

响应：

```ts
{
  challenge: {
    challengeId: string;
    mode: "inline_value";
    imageData: string;
    expiresAt: string;
  };
}
```

### `POST /api/admin/session/login`

创建后台登录会话。

请求：

```ts
{
  username: string;
  password: string;
  challengeId?: string;
  captchaValue?: string;
}
```

响应：

```ts
{
  authenticated: true;
  session: {
    expiresAt: string;
  };
}
```

### `POST /api/admin/session/logout`

清理当前后台会话 cookie。

响应：

```ts
{
  authenticated: false;
}
```

### `GET /api/admin/session/me`

获取当前后台会话和可管理站点摘要。

响应：

```ts
{
  authenticated: true;
  session: {
    expiresAt: string;
  };
  sites: Array<{
    siteKey: string;
    name: string;
  }>;
}
```

## Overview

### `GET /api/admin/overview`

获取后台首页概览、统计和运行时日志配置。

响应：

```ts
{
  console: {
    path: string;
  };
  runtime: {
    devMode: boolean;
  };
  stats: {
    siteCount: number;
    pageCount: number;
    commentCount: number;
    pendingCommentCount: number;
    commenterCount: number;
    visitorCount: number;
    blacklistRuleCount: number;
  };
  logging: {
    level: string;
    retentionDays: number;
    directory: string;
  };
}
```

## Comments

### `GET /api/admin/comments`

分页列出后台评论。

Query：

```ts
{
  siteKey?: string;
  pageKey?: string;
  status?: "pending" | "approved" | "spam" | "trash";
  statusGroup?: "hidden"; // spam + trash，用于后台“垃圾与回收站”合并视图
  search?: string;
  limit?: number;  // default 20, max 100
  offset?: number; // default 0
}
```

响应：

```ts
{
  items: AdminComment[];
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
  };
}
```

`AdminComment`：

```ts
{
  id: string;
  parentId: string | null;
  status: "pending" | "approved" | "spam" | "trash";
  authorName: string;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  authorIp: string | null;
  authorUserAgent: string | null;
  blacklist: {
    email: boolean;
    ip: boolean;
  };
  contentRaw: string;
  isPinned: boolean;
  isFolded: boolean;
  replyCount: number;
  voteUpCount: number;
  voteDownCount: number;
  createdAt: string;
  updatedAt: string;
  pageKey: string;
  pageTitle: string | null;
  pageUrl: string | null;
}
```

### `PATCH /api/admin/comments/{commentId}`

更新评论状态、置顶、折叠或正文。

请求至少包含一个字段：

```ts
{
  status?: "pending" | "approved" | "spam" | "trash";
  isPinned?: boolean;
  isFolded?: boolean;
  contentRaw?: string;
}
```

响应：

```ts
{
  comment: AdminComment;
}
```

### `DELETE /api/admin/comments/{commentId}`

软删除评论。

响应：

```ts
{
  comment: AdminComment;
}
```

### `POST /api/admin/comments/{commentId}/reply`

使用当前站点的可信评论作者配置快速回复评论。该接口只能由已登录后台会话调用，创建的回复会直接标记为 `approved`，并在公开评论树中展示当前站点配置的 badge label。

请求：

```ts
{
  content: {
    raw: string;
  };
}
```

响应：

```ts
{
  comment: PublicComment;
}
```

若目标评论不存在，返回 `COMMENT_NOT_FOUND`；若该站点未启用可信评论作者，返回 `VERIFIED_AUTHOR_DISABLED`。

## Pages, Commenters, Visitors

以下三个列表接口共享分页 query：

```ts
{
  siteKey?: string;
  search?: string;
  limit?: number;  // default 20, max 100
  offset?: number; // default 0
}
```

响应均为：

```ts
{
  items: T[];
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
  };
}
```

### `GET /api/admin/pages`

页面聚合视图。单项结构：

```ts
{
  siteKey: string;
  pageKey: string;
  status:
    | "active"
    | "stale"
    | "unreachable"
    | "not_found"
    | "trash"
    | "deleted"
    | "ignored";
  pageTitle: string | null;
  pageUrl: string | null;
  commentCount: number;
  rootCommentCount: number;
  pageLikeCount: number;
  updatedAt: string;
  createdAt: string;
  trashedAt: string | null;
  deletedAt: string | null;
  titleRefreshAttemptedAt: string | null;
  titleRefreshedAt: string | null;
  titleRefreshStatusCode: number | null;
  titleRefreshError: string | null;
  visitorCount: number;
  commenterCount: number;
}
```

### `POST /api/admin/pages/{pageKey}/title/refresh`

为单个页面创建服务端异步 title 刷新任务。该接口只创建任务，页面 HTML 抓取在服务端 maintenance job 中执行。

请求：

```ts
{
  siteKey: string;
  runAfter?: string | null;
  maxAttempts?: number;
  retryDelaySec?: number;
}
```

响应：

```ts
{
  job: MaintenanceJob;
}
```

### `POST /api/admin/pages/{pageKey}/trash`

将页面移入回收站。

请求：

```ts
{
  siteKey?: string;
}
```

### `POST /api/admin/pages/{pageKey}/restore`

恢复回收站页面。

### `POST /api/admin/pages/{pageKey}/delete`

将回收站页面标记为删除。

## Page Registry

### `GET /api/admin/page-registry/sources`

列出当前站点页面来源。

Query：

```ts
{
  siteKey: string;
}
```

响应：

```ts
{
  items: PageRegistrySource[];
}
```

### `POST /api/admin/page-registry/sources`

创建 sitemap、RSS 或 Atom 页面来源。

请求：

```ts
{
  siteKey: string;
  sourceType: "sitemap" | "rss" | "atom";
  sourceUrl: string;
  enabled: boolean;
  mode: "append" | "replace";
  refreshIntervalSec?: number | null;
}
```

### `DELETE /api/admin/page-registry/sources/{sourceId}`

删除页面来源配置和来源-页面关联，不删除页面登记、评论、点赞或访问数据。

响应：

```ts
{
  ok: true;
}
```

### `POST /api/admin/page-registry/sources/{sourceId}/refresh`

为单个来源创建 `page_source_refresh` 任务。

响应：

```ts
{
  job: MaintenanceJob;
}
```

### `POST /api/admin/page-registry/refresh`

为当前站点全部来源创建 `page_source_refresh` 任务。

请求：

```ts
{
  siteKey: string;
  mode?: "append" | "replace";
}
```

来源刷新如果命中待处理未知页面，会自动放行 pending candidate 并合并待处理访问量。

### `GET /api/admin/page-registry/maintenance-jobs/{jobId}`

获取页面来源维护任务。

响应：

```ts
{
  job: MaintenanceJob | null;
}
```

### `GET /api/admin/commenters`

按评论邮箱聚合的匿名评论者视图。该接口不是后台登录用户、账号或权限主体。单项结构：

```ts
{
  email: string;
  emailVariants: string[];
  names: string[];
  commentCount: number;
  pendingCount: number;
  approvedCount: number;
  lastCommentAt: string | null;
  pageCount: number;
  siteCount: number;
  ips: string[];
  userAgents: string[];
  blacklist: {
    email: boolean;
  };
  isBlacklisted: boolean;
  notifications?: {
    notifyOnReply?: boolean | null;
    unsubscribedAt?: string | null;
    suppressedUntil?: string | null;
    reputationScore?: number | null;
    lastSuccessAt?: string | null;
    lastFailureAt?: string | null;
  };
}
```

`email` 是 trim + lower-case 后的聚合键；`emailVariants` 保留该聚合组中出现过的原始邮箱写法。搜索邮箱时同样按归一化值匹配，因此 `Virace@aliyun.com` 和 `virace@aliyun.com` 会归到同一个评论者视图。`/api/admin/users` 命名空间保留给未来真正的后台用户或账号系统。

`notifications` 汇总当前站点内该邮箱的普通评论者回复通知状态。`notifyOnReply=true` 表示该邮箱已选择接收已审核回复邮件；`unsubscribedAt` 来自全局退订链接；`suppressedUntil`、`reputationScore`、`lastSuccessAt` 和 `lastFailureAt` 来自投递 reputation，不等同于退订。明显占位或无效邮箱不会创建偏好，评论创建仍可继续。

### `GET /api/admin/visitors`

按 visitor key 聚合的访客视图。访客记录关闭时返回禁用元信息和空列表。

响应：

```ts
{
  enabled: boolean;
  trustMode: "trusted" | "lightweight";
  items: AdminVisitor[];
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
  };
  message?: string;
}
```

访客记录关闭时：

```ts
{
  enabled: false;
  trustMode: "lightweight";
  items: [];
  pagination: {
    limit: number;
    offset: number;
    totalCount: 0;
  };
  message: "访客记录未启用。QingYan 当前不记录访客身份，也不提供访客画像。";
}
```

`AdminVisitor`：

```ts
{
  siteKey: string;
  visitorKey: string;
  lastSeenAt: string;
  createdAt: string;
  commentCount: number;
  pageCount: number;
  emailCount: number;
  emails: string[];
  ips: string[];
  userAgents: string[];
  blacklist: {
    visitor: boolean;
  };
}
```

## Blacklist

### `GET /api/admin/blacklist`

列出黑名单规则。

Query：

```ts
{
  siteKey?: string;
}
```

响应：

```ts
{
  items: AdminBlacklistRule[];
}
```

`AdminBlacklistRule`：

```ts
{
  id: number;
  siteId: number | null;
  scope: "post" | "all";
  targetType: "ip" | "email" | "visitor";
  targetValue: string;
  matchMode: "exact" | "cidr" | "wildcard";
  reason: string | null;
  source: string;
  expiresAt: string | null;
  createdAt: string;
}
```

### `POST /api/admin/blacklist`

创建黑名单规则。

请求：

```ts
{
  siteKey?: string;
  targetType: "ip" | "email" | "visitor";
  matchMode?: "exact" | "cidr" | "wildcard"; // default "exact"
  targetValue: string;
  scope?: "post" | "all"; // default "post"
  reason?: string;
  expiresAt?: string;
}
```

响应：

```ts
{
  rule: AdminBlacklistRule;
}
```

### `DELETE /api/admin/blacklist/target`

按目标删除匹配的黑名单规则。

请求：

```ts
{
  siteKey?: string;
  targetType: "ip" | "email" | "visitor";
  matchMode?: "exact" | "cidr" | "wildcard"; // default "exact"
  targetValue: string;
}
```

响应：

```ts
{
  rules: AdminBlacklistRule[];
}
```

### `DELETE /api/admin/blacklist/{ruleId}`

按规则 ID 删除黑名单规则。

响应：

```ts
{
  rule: AdminBlacklistRule;
}
```

## Sites

### `GET /api/admin/sites`

列出站点总览和设置摘要。

响应：

```ts
{
  items: AdminSite[];
}
```

`AdminSite`：

```ts
{
  siteKey: string;
  name: string;
  allowedOrigins: string[];
  comments: {
    enabled: boolean;
    defaultStatus: "pending" | "approved";
    moderation: {
      mode: "none" | "akismet_auto" | "manual_with_akismet" | "manual";
      provider: "none" | "akismet";
      akismet: {
        failPolicy: "pending";
        discardBlatantSpam: boolean;
      };
    };
    identity: {
      allow: Array<"nickname" | "email" | "website">;
      require: Array<"nickname" | "email" | "website">;
    };
    allowWebsite: boolean;
    verifiedAuthor: {
      enabled: boolean;
      displayName: string;
      email: string;
      website: string;
      badgeLabel: string;
    };
    staffDisplay: {
      nameMode: "current_profile" | "snapshot";
    };
    captcha: {
      mode: "never" | "always" | "threshold";
    };
  };
  pageFeedback: {
    allowLike: boolean;
  };
  notifications: {
    emailEnabled: boolean;
    recipients?: SiteNotificationRecipient[];
    channelConfigs: NotificationChannelConfig[];
  };
  pageCount: number;
  commentCount: number;
  commenterCount: number;
  visitorCount: number;
}
```

### `POST /api/admin/sites`

创建站点。

请求：

```ts
{
  siteKey: string;
  name: string;
  allowedOrigins: string[];
}
```

响应：

```ts
{
  items: AdminSite[];
}
```

### `PATCH /api/admin/sites/{siteKey}`

更新站点名称或允许来源。

请求至少包含一个字段：

```ts
{
  name?: string;
  allowedOrigins?: string[];
}
```

响应：

```ts
{
  items: AdminSite[];
}
```

## Site Settings

### `GET /api/admin/sites/{siteKey}/settings`

获取站点完整设置。

响应：

```ts
AdminSettings
```

### `PUT /api/admin/sites/{siteKey}/settings`

更新站点设置。请求至少包含 `comments`、`pageFeedback`、`engagement`、`notifications` 之一；其中内部字段均可局部提交。`engagement.pageLikes.enabled` 是页面点赞的 canonical 开关，`pageFeedback.allowLike` 仅作为过渡显示字段同步。

Admin Settings API 的 canonical 开关路径：

- 评论：`comments.enabled`
- 评论验证码策略：`comments.captcha.mode`
- 评论投票：`engagement.commentVotes.enabled`
- 页面浏览量：`engagement.pageViews.enabled`
- 页面点赞：`engagement.pageLikes.enabled`
- 访客记录：`engagement.visitors.enabled`
- 当前站点邮件通知：`notifications.emailEnabled`
- 当前站点后台用户通知接收人：`notifications.recipients`

`pageFeedback.allowLike` 是过渡同步字段；新 UI 和新调用代码应以 `engagement.pageLikes.enabled` 为页面点赞 canonical 开关。

请求：

```ts
Partial<AdminSettings>
```

响应：

```ts
AdminSettings
```

`AdminSettings`：

```ts
{
  siteKey: string;
  comments: {
    enabled: boolean;
    defaultStatus: "pending" | "approved";
    moderation: {
      mode: "none" | "akismet_auto" | "manual_with_akismet" | "manual";
      provider: "none" | "akismet";
      akismet: {
        failPolicy: "pending";
        discardBlatantSpam: boolean;
      };
    };
    maxDepth: number;
    rootLimit: number;
    identity: {
      allow: Array<"nickname" | "email" | "website">;
      require: Array<"nickname" | "email" | "website">;
    };
    allowWebsite: boolean;
    verifiedAuthor: {
      enabled: boolean;
      displayName: string;
      email: string;
      website: string;
      badgeLabel: string;
    };
    staffDisplay: {
      nameMode: "current_profile" | "snapshot";
    };
    captcha: {
      mode: "never" | "always" | "threshold";
      thresholdWindowSec: number;
      thresholdMaxActions: number;
    };
    abuseGuard: {
      enabled: boolean;
      windowSec: number;
      maxWriteActions: number;
      autoBlacklist: {
        enabled: boolean;
        scope: "post" | "all";
        ttlSec: number;
      };
    };
    metadata: {
      collectIp: boolean;
      collectUserAgent: boolean;
      ipRegion: {
        enabled: boolean;
        precision: "country" | "province" | "city";
      };
      device: {
        enabled: boolean;
        display: {
          enabled: boolean;
        };
      };
    };
  };
  pageFeedback: {
    allowLike: boolean;
  };
  engagement: {
    visitors: {
      enabled: boolean;
    };
    pageViews: {
      enabled: boolean;
    };
    pageLikes: {
      enabled: boolean;
    };
    commentVotes: {
      enabled: boolean;
    };
  };
  notifications: {
    emailEnabled: boolean;
    recipients?: Array<{
      userId: number;
      username: string;
      email: string;
      displayName: string;
      // compatibility projection, derived from routes
      channels: Array<"email" | "webhook" | "wxpusher">;
      // compatibility projection, derived from routes
      events: Array<"admin_comment_pending" | "admin_comment_approved">;
      routes: Array<{
        id?: string;
        eventType: "admin_comment_pending" | "admin_comment_approved";
        channelConfigId: string;
        channelType?: "email" | "webhook" | "wxpusher";
        channelName?: string;
        enabled: boolean;
      }>;
      includeCommentContent: "none" | "summary" | "full";
      rateLimitProfile: string | null;
      enabled: boolean;
    }>;
    channelConfigs: NotificationChannelConfig[];
  };
}
```

后台用户通知接收人引用 `admin_users.id`，不使用可信评论作者邮箱或任意手写邮箱作为长期接收人。管理员和初始管理员可配置任意站点；站点管理员只能配置自己有访问权的站点，且候选接收人也必须对该站点有访问权；站点评论管理员不可管理接收人。

接收人配置的 canonical 模型是 `notifications.recipients[].routes[]`。每条 route 绑定一个事件和一个具体渠道配置实例，例如 `email:default`、`wxpusher:ops` 或 `webhook:feishu`。`channels` 和 `events` 仍作为兼容投影返回，旧请求也可用它们生成默认 route；新 Admin UI 和新调用代码应提交 `routes`。`admin_comment_pending` 在评论进入待审核时创建；直接通过审核的评论创建 `admin_comment_approved`；待审核评论后续通过审核只保留审核语义，不追加第二条后台用户通知。

Engagement 语义：

- `visitors.enabled=true`：QingYan 记录访客 IP、UA 和访问页面，用 visitorId 对 PV、页面点赞、评论投票做服务端可信去重，后续可用于访客画像。
- `visitors.enabled=false`：QingYan 不创建 visitor row，不设置新的 `qingyan_visitor` cookie，不写 visitorId 关联记录。PV、页面点赞、评论投票如开启，只做轻量低可信计数。
- `pageViews.enabled=false`：不记录 PV，也不创建 pending page view session。
- `pageLikes.enabled=false`：公开页面点赞接口返回 `PAGE_FEEDBACK_DISABLED`。
- `commentVotes.enabled=false`：公开评论投票接口返回 `COMMENT_VOTE_DISABLED`。

Settings API 的双状态字段必须使用 JSON boolean。GET 会归一化历史持久化配置中的 `0` / `1`，响应永远返回 `true` / `false`；PUT 不接受数字布尔、字符串布尔或 `0` / `1`。数字布尔请求会返回字段级错误：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请求参数无效。",
    "requestId": "req_xxx",
    "fields": [
      {
        "path": "engagement.commentVotes.enabled",
        "code": "invalid_type",
        "expected": "boolean",
        "received": "number",
        "message": "必须是 JSON boolean，不能使用 0/1。"
      }
    ]
  }
}
```

公开 bootstrap 会把这些开关映射到 `features`：`comments.enabled=false` 时返回 `features.comments.enabled=false` 并省略 `data.comments`；`engagement.pageViews.enabled=false` 时省略 `data.pageViews`；`engagement.pageLikes.enabled=false` 时省略 `data.pageLikes`；`engagement.commentVotes.enabled=false` 时评论项不输出 `vote`。

Admin Console 保存失败时会展示 `requestId` 和 `fields[]`。字段级错误的 `path` 使用 Admin Settings API canonical path，不使用公开 bootstrap 的 `features.*` path。

## System Settings

### `GET /api/admin/system-settings`

获取全局系统设置。secret 明文不会返回，只返回 `*Configured` 状态。

响应：

```ts
AdminSystemSettings
```

### `PUT /api/admin/system-settings`

更新全局系统设置。`logging` 当前为必填；`admin`、`mail`、`notifications`、`captcha`、`ipRegion`、`avatar`、`publicApi` 可按后台表单提交。secret 字段为空时前端会省略，后端保留已有值。

`mail.enabled` 和 `mail.smtp.*` 是 system owner，影响实例级邮件发送能力。`notifications.emailEnabled` 是 site owner，只控制当前站点是否发送通知。

`notifications.delivery.queueBackend` 默认是 `database`。选择 `bullmq` 时需要部署 Redis 并配置相应运行环境；BullMQ 只影响队列后端，不改变 planner、delivery projection、worker 状态模型或任务中心展示。

Webhook 和 WxPusher 的 canonical 配置模型是 `notifications.channelConfigs[]`。每个元素是一条具体渠道配置实例，例如 `webhook:feishu`、`webhook:ops`、`wxpusher:audit`；站点接收人再通过 route 的 `channelConfigId` 选择具体实例。`email:default` 是只读默认邮件实例，GET 会返回，PUT 可原样带回但不会作为可编辑实例落库。Webhook/WxPusher 的 `secretConfig.secret`、`secretConfig.appToken` 是 secret 字段，GET 响应只返回 `secretConfigured` 状态；PUT 省略或提交空 `secretConfig` 会保留已有密钥。

`avatar.external.enabled` 控制外部头像 URL 生成。`avatar.display.*` 和 `publicApi.advisoryFields.enabled` 控制可选公开展示建议字段，不能简单视为 `avatar.external.enabled` 的子设置。

System Settings validation failure 同样返回 `VALIDATION_FAILED + fields[]`：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请求参数无效。",
    "requestId": "req_xxx",
    "fields": [
      {
        "path": "mail.enabled",
        "code": "invalid_type",
        "expected": "boolean",
        "received": "number",
        "message": "必须是 JSON boolean，不能使用 0/1。"
      }
    ]
  }
}
```

响应：

```ts
AdminSystemSettings
```

`AdminSystemSettings`：

```ts
{
  admin: {
    session: {
      ttlMinutes: number;
    };
  };
  logging: {
    level: "error" | "warn" | "info" | "debug";
    retentionDays: number;
    directory: string;
  };
  mail: {
    enabled: boolean;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password?: string;
      passwordConfigured: boolean;
      from: string;
    };
  };
  notifications: {
    delivery: {
      globalMaxPerMinute: number;
      perChannelMaxPerMinute: number;
      perSiteMaxPerHour: number;
      perRecipientMinIntervalSec: number;
      dailyChannelBudget: number;
      lowPriorityDelaySec: number;
      queueBackend: "database" | "bullmq";
    };
    channelConfigs: Array<{
      id: string;
      type: "email" | "webhook" | "wxpusher";
      name: string;
      description: string | null;
      enabled: boolean;
      config: Record<string, unknown>;
      secretConfig?: Record<string, unknown>;
      secretConfigured?: boolean;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
    // compatibility settings, not the canonical Webhook/WxPusher model
    webhook: {
      enabled: boolean;
      url: string;
      secret?: string;
      secretConfigured: boolean;
    };
    wxpusher: {
      enabled: boolean;
      appToken?: string;
      appTokenConfigured: boolean;
      apiUrl: string;
    };
  };
  captcha: {
    provider: "image" | "turnstile" | "hcaptcha" | "recaptcha" | "geetest";
    image: {
      width: number;
      height: number;
      ttlSec: number;
    };
    turnstile: {
      siteKey: string;
      secretKey?: string;
      secretKeyConfigured: boolean;
      expectedAction: string;
      expectedHostname?: string;
    };
    hcaptcha: {
      siteKey: string;
      secretKey?: string;
      secretKeyConfigured: boolean;
      expectedHostname?: string;
    };
    recaptcha: {
      variant: "score_based" | "policy_based_challenge";
      projectId: string;
      siteKey: string;
      apiKey?: string;
      apiKeyConfigured: boolean;
      expectedAction: string;
      expectedHostname?: string;
      minScore: number;
    };
    geetest: {
      captchaId: string;
      captchaKey?: string;
      captchaKeyConfigured: boolean;
      apiServer: string;
    };
  };
  ipRegion: {
    enabled: boolean;
    cachePolicy: "file" | "vectorIndex" | "content";
    precision: "country" | "province" | "city";
    autoUpdate: {
      enabled: boolean;
      schedule: "monthly";
    };
    ipv4: {
      dbPath: string;
      sources: string[];
    };
    ipv6: {
      dbPath: string;
      sources: string[];
    };
  };
  avatar: {
    external: {
      enabled: boolean;
      baseUrl: string;
      hashAlgorithm: "sha256" | "md5";
      query: string;
    };
    display: {
      shape: "circle" | "rounded" | "square";
      sizePx: number;
    };
  };
  publicApi: {
    advisoryFields: {
      enabled: boolean;
    };
  };
  antiSpam: {
    akismet: {
      apiKey?: string;
      apiKeyConfigured: boolean;
    };
  };
}
```

### `POST /api/admin/system-settings/notifications/channel-test`

创建通知通道测试任务。该接口需要 `system_settings.update` 权限，会创建 `channel_test` 类型的 `task_runs` 和对应 `notification_deliveries`，再由通知 worker 或测试流程投递。

请求：

```ts
{
  channelConfigId: string;
  // compatibility fallback; new clients should use channelConfigId
  channel?: "email" | "webhook" | "wxpusher";
  recipient?: string;
  siteKey?: string;
}
```

响应：

```ts
{
  taskId: string;
  deliveryId: string;
  queueBackend: "database" | "bullmq";
  channelConfigId: string;
  channelType: "email" | "webhook" | "wxpusher";
  channelName: string;
  channel: "email" | "webhook" | "wxpusher";
  recipient: string;
}
```

## Notification Templates

通知模板接口主要服务 Admin Console 的模板管理页。模板支持 `html`、`text` 和 `json` 输出格式；变量渲染会按目标格式进行 escaping，JSON 模板渲染后必须是合法 JSON。

### `GET /api/admin/notification-templates`

列出默认模板和数据库中的自定义覆盖。需要 `system_settings.read` 权限。

响应：

```ts
{
  templates: Array<{
    key: string;
    name: string;
    description: string;
    channel: "email" | "webhook" | "wxpusher";
    channelLabel: string;
    channelDescription: string;
    eventType: string;
    eventLabel: string;
    eventDescription: string;
    format: "html" | "text" | "json";
    formatLabel: string;
    subjectTemplate: string | null;
    bodyTemplate: string;
    isCustomized: boolean;
    updatedAt: string | null;
    updatedByUserId: number | null;
  }>;
}
```

`name`、`description`、`channelLabel`、`channelDescription`、`eventLabel`、`eventDescription` 和 `formatLabel` 均为中文展示文案，来自内置默认模板元数据；数据库自定义覆盖只覆盖格式和模板内容，不覆盖这些展示字段。

### `PUT /api/admin/notification-templates/{templateKey}`

保存模板覆盖。需要 `system_settings.update` 权限。

请求：

```ts
{
  format: "html" | "text" | "json";
  subjectTemplate?: string | null;
  bodyTemplate: string;
}
```

响应：

```ts
{
  template: NotificationTemplate;
}
```

### `POST /api/admin/notification-templates/{templateKey}/preview`

使用预置示例变量预览模板渲染结果。需要 `system_settings.read` 权限；请求体可为空，也可临时覆盖格式和模板内容。

响应：

```ts
{
  rendered: {
    subject?: string;
    body: string;
  };
}
```

### `POST /api/admin/notification-templates/{templateKey}/restore-default`

删除该模板的数据库覆盖，恢复默认模板。需要 `system_settings.update` 权限。

响应：

```ts
{
  template: NotificationTemplate;
}
```

### `POST /api/admin/notification-templates/{templateKey}/test-send`

创建模板测试发送任务。需要 `system_settings.update` 权限；`recipient` 省略时使用当前后台用户邮箱。

请求：

```ts
{
  recipient?: string;
}
```

响应：

```ts
{
  taskId: string;
  deliveryId: string;
  queueBackend: "database" | "bullmq";
  channel: "email" | "webhook" | "wxpusher";
  recipient: string;
  preview: {
    subject?: string;
    body: string;
  };
}
```

## Import And Export

### `GET /api/admin/import-export/jobs`

列出导入任务记录。

Query：

```ts
{
  siteKey?: string;
  status?: string;
  sourceType?: string;
  limit?: number; // default 20, max 100
}
```

响应：

```ts
{
  items: ImportJobListItem[];
  nextCursor: string | null;
}
```

### `GET /api/admin/import-export/jobs/{jobId}`

获取单个导入任务记录。

响应：

```ts
{
  job: ImportJobListItem;
}
```

`ImportJobListItem`：

```ts
{
  id: string;
  siteId: number;
  sourceType: string;
  sourceFileName: string;
  format: string;
  formatVersion: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  summary: unknown;
  backup: ImportJobBackup | null;
  error: unknown;
}
```

### `POST /api/admin/import-export/export`

导出 QingYan 站点数据，响应会带 `content-disposition` 下载文件名。

请求：

```ts
{
  siteKey: string;
  format: "qingyan.export.v1";
  include?: {
    siteSettings?: boolean;
    systemSettings?: boolean;
    pageThreads?: boolean;
    comments?: boolean;
    visitors?: boolean;
    voteRecords?: boolean;
    pageFeedbackRecords?: boolean;
    blacklistRules?: boolean;
  };
}
```

### `POST /api/admin/import-export/qingyan/dry-run`

对 QingYan JSON 导入做 dry-run，并创建导入任务。

请求：

```ts
{
  siteKey: string;
  fileName: string;
  payload: unknown;
  existingStrategy: "fail_on_existing" | "skip_existing";
  importMode?: "data_only" | "settings_only" | "full_site";
  settingsStrategy?: "fail_on_existing" | "replace_settings";
}
```

### `POST /api/admin/import-export/qingyan/jobs/{jobId}/apply`

应用 QingYan JSON 导入任务，并在写入前创建数据库备份。

请求：

```ts
{
  existingStrategy: "fail_on_existing" | "skip_existing";
  importMode?: "data_only" | "settings_only" | "full_site";
  settingsStrategy?: "fail_on_existing" | "replace_settings";
}
```

### `POST /api/admin/import-export/wordpress/analyze`

分析 WordPress WXR。Admin Console Web 当前以 XML 文件 body 上传：

- Query 使用除 `xml` 外的 `WordPressAnalyzePayload` 字段。
- `Content-Type` 为 `application/xml` 或 `text/xml`。
- Body 为 WXR XML 文本。

Query：

```ts
{
  siteKey: string;
  fileName: string;
  sourceBasePath?: string;
  targetDistRoot?: string;
  pageKeyStrategy?:
    | "path_without_leading_slash"
    | "path_with_leading_slash"
    | "page_url_path"
    | "custom_template"
    | "explicit_only";
  postPathTemplate?: string;
  pagePathTemplate?: string;
  mappingJson?: string;
}
```

响应包含 `job`、`report` 和 `suggestedMapping`。`report.authorSummary` 会汇总 WXR 作者匹配结果：

```ts
{
  totalAuthors: number;
  staffStrong: number;
  staffEmailCandidate: number;
  registeredUnknown: number;
  visitor: number;
}
```

每个 `report.items[].comments[]` 可包含 `authorMatch.kind`：`staff_strong` 表示 `comment_user_id` 匹配 `wp:author_id`；`staff_email_candidate` 表示未登录评论但邮箱匹配 WXR 作者，需要在生成计划前确认；`registered_unknown` 表示有非 0 用户 ID 但 WXR 作者列表没有对应项；`visitor` 表示普通访客评论。`report.htmlContentSummary` 会统计原始评论内容中疑似 HTML 标签的数量和少量示例；当前导入仍按纯文本转义。

### `POST /api/admin/import-export/wordpress/jobs/{jobId}/plan`

把 WordPress analyze job 转换为导入 plan。若 analyze 报告中存在 `staff_email_candidate`，请求必须提供 `authorDecisions`；强匹配 `staff_strong` 会自动进入 `authorIdentity: "verified"`，显式拒绝的邮箱候选会按 `visitor` 导入。

请求：

```ts
{
  authorDecisions?: Record<string, "verified" | "visitor">; // key 为 oldCommentId
}
```

响应包含 `job` 和 `plan.summary`。

### `POST /api/admin/import-export/jobs/{jobId}/dry-run`

对通用导入任务做 dry-run。

请求：

```ts
{
  existingStrategy: "fail_on_existing" | "skip_existing";
}
```

### `POST /api/admin/import-export/jobs/{jobId}/apply`

应用通用导入任务，并在写入前创建数据库备份。

请求：

```ts
{
  existingStrategy: "fail_on_existing" | "skip_existing";
}
```

`ImportJobBackup`：

```ts
{
  kind: "import_database_backup";
  engine: string;
  strategy: string;
  createdAt: string;
  backupDirectory: string;
  databaseBackupPath?: string;
  files: Array<{
    role: "database" | "wal" | "shm" | "metadata";
    path: string;
    backupPath: string | null;
    present: boolean;
    size: number | null;
    sha256: string | null;
  }>;
  notes: string[];
}
```

## Ops

### `GET /api/admin/ops/status`

获取运维页状态。

响应：

```ts
{
  version: {
    current: string;
  };
  update: {
    supported: boolean;
    entry: "service-action";
    description: string;
    estimatedRestartSeconds: {
      min: number;
      max: number;
    };
    check: UpdateCheckResult;
  };
  upgrade: {
    state:
      | "not_installed"
      | "normal_current"
      | "upgrade_required"
      | "recovery_required"
      | "broken_config";
    plan?: unknown;
  };
  backup: {
    format: "qingyan.full-backup";
    provider: "sqlite";
  };
  recovery: {
    manualCommands: string[];
  };
}
```

### `POST /api/admin/ops/upgrade/dry-run`

返回与 Web Upgrade Mode 相同的公开升级状态和脱敏计划。

### `POST /api/admin/ops/update/plan`

返回程序更新计划。该接口只生成提示，不直接下载、替换或重启程序。

响应：

```ts
{
  kind: "program-update";
  executor: "qingyan.service";
  description: string;
  estimatedRestartSeconds: {
    min: number;
    max: number;
  };
  steps: string[];
  manualCommands: string[];
}
```

### `POST /api/admin/ops/update/check`

检查 GitHub Releases 更新状态，不执行程序更新。

响应：

```ts
{
  state:
    | "not_checked"
    | "no_release"
    | "current"
    | "update_available"
    | "unsupported_release"
    | "check_failed";
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  tagName?: string;
  publishedAt?: string;
  prerelease?: boolean;
  autoUpdatable: boolean;
  source: {
    provider: "github-releases";
    owner: string;
    repo: string;
    url: string;
  };
  message: string;
  checkedAt?: string;
  errorCode?: string;
}
```

### `GET /api/admin/ops/service-control`

获取后台服务控制状态。默认 `QINGYAN_ADMIN_SERVICE_CONTROL` 未设置或不为
`systemd` 时禁用，不会调用 `systemctl`。

响应：

```ts
{
  enabled: boolean;
  mode: "disabled" | "systemd";
  unit: "qingyan.service";
  state: "running" | "stopped" | "unknown";
  restart: {
    confirmation: "RESTART QINGYAN";
  };
}
```

### `POST /api/admin/ops/service-control/restart`

重启 QingYan 服务。该接口需要管理员会话、CSRF token，并且后端启用
`QINGYAN_ADMIN_SERVICE_CONTROL=systemd`。请求会写入审计日志。

请求：

```ts
{
  confirm: "RESTART QINGYAN";
}
```

响应：

```ts
{
  ok: true;
  state: "running" | "stopped" | "unknown";
}
```

错误：

- `400 INVALID_REQUEST`：确认短语不匹配。
- `403 SERVICE_CONTROL_DISABLED`：服务控制未启用。

### `GET /api/admin/ops/tasks`

任务中心列表。该接口聚合旧 `maintenance_jobs` 与新 `task_runs` 投影；导入任务仍由 import-export job API 管理。

Query：

```ts
{
  siteKey?: string;
  type?: string;
  status?: string;
  limit?: number; // default 20, max 100
}
```

响应：

```ts
{
  items: AdminTaskCenterItem[];
  totalCount: number;
  limit: number;
  offset: number;
}
```

`MaintenanceJob`：

```ts
{
  id: string;
  type:
    | "ip_region_update"
    | "comment_ip_refresh"
    | "page_source_refresh"
    | "page_metadata_refresh";
  status:
    | "queued"
    | "delayed"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "cancelled";
  siteKey: string | null;
  scope: unknown;
  progress: unknown;
  result: unknown;
  error: unknown;
  runAfter: string | null;
  attempts: number;
  maxAttempts: number;
  retryDelaySec: number;
  concurrencyKey: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}
```

`TaskRunCenterItem`：

```ts
{
  source: "task_run";
  id: string;
  queueBackend: "database" | "bullmq";
  queueMessageId: string | null;
  type: string;
  category:
    | "notification"
    | "import"
    | "maintenance"
    | "backup"
    | "upgrade"
    | "page"
    | "system";
  status:
    | "queued"
    | "delayed"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "suppressed"
    | "cancelled";
  siteId: number | null;
  siteKey: string | null;
  actorType: "admin_user" | "system" | "visitor" | null;
  actorId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  payloadSummary: unknown;
  payload: unknown;
  scope: unknown;
  progress: unknown;
  result: unknown;
  error: unknown;
  idempotencyKey: string | null;
  runAfter: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}
```

通知任务会在 `payloadSummary` / `payload` / `result` 中提供排障用 event、channel、channel config id/name、recipient type、recipient address snapshot、attempt、next retry、error 和 provider message id。`notification_deliveries.channelConfigRef` 与 `notification_deliveries.channelConfigNameSnapshot` 保存任务创建时的渠道配置快照，用于区分多个 Webhook 或 WxPusher 配置实例。拥有 `tasks.read` 的后台用户可以在任务中心查看这些内部排障字段；公开 API 不暴露这些字段。secret 和明文退订 token 不会写入 task payload、日志、导出或 Admin API 响应。
