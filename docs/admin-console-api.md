# Admin Console Web API

本文档记录 QingYan 自带 Admin Console Web 当前使用的 `/api/admin/*` 接口，供开发者调试、扩展内置后台或排查前后端调用时查询。

这些接口不进入公开 `docs/openapi.yaml`，也不作为第三方内容站点前端的稳定公共合同维护。它们不是禁止使用的接口，但主要服务内置 Admin Console，可能随后台页面、组件和数据模型一起调整；第三方站点前端不建议直接依赖这些路径或响应结构。

## 通用约定

- 运行时完整路径带 `server.publicPath` 前缀，默认是 `/qingyan/api/admin/*`；本文后续用 Admin Console 源码中的相对写法 `/api/admin/*` 表示同一组接口。
- Base URL 与服务部署地址一致，例如本地开发默认 `http://localhost:4401`。
- Admin Console Web 使用 same-origin fetch，请求默认携带 cookie：`credentials: "include"`。源码中的 `/api/*` 会通过页面注入的 `__QINGYAN_ADMIN__.apiBase` 解析到当前实例的 `${server.publicPath}/api`。
- 除 WordPress WXR 上传分析接口外，请求体和响应体默认是 JSON。
- 已登录接口使用后台会话 cookie，默认 cookie 名由 `admin.session.cookieName` 配置决定，示例为 `qingyan_admin`。
- 登录验证码是内置图片验证码，当前后台登录接口接受 `challengeId` 和 `captchaValue`。
- `POST`、`PUT`、`PATCH`、`DELETE` 写操作需要管理员会话和 CSRF token。登录和 `GET /api/admin/session/me` 会返回 `csrf.header` 与 `csrf.token`，Admin Console 后续写请求会把 token 放入对应 header。
- 错误响应沿用全局错误结构：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "错误说明",
    "requestId": "可选请求 ID",
    "fields": [],
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
  csrf: {
    header: string;
    token: string;
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
  csrf: {
    header: string;
    token: string;
  };
  user: {
    id: number;
    username: string;
    email: string;
    displayName: string;
    groupKey: "admin" | "site_admin" | "site_moderator";
    groupName: string;
    isInitialAdmin: boolean;
    passwordChangeRequired: boolean;
  };
  permissions: string[];
  sites: Array<{
    siteKey: string;
    name: string;
    allowedOrigins: string[];
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

为单个页面创建服务端异步 title 刷新任务。该接口只创建 `task_runs` 运行记录，页面 HTML 抓取由统一任务运行器执行。

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
  run: TaskRunProjection;
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

页面来源刷新不再提供 source CRUD API。权威模式的 sitemap 地址由站点设置
`pageRegistry.authoritativeSitemapUrls` 管理，并同步到系统托管的
`page_source_refresh` 任务 payload `sitemapUrls`。

### `GET /api/admin/page-registry/pending`

列出当前站点待审核未知页面。

Query：

```ts
{
  siteKey: string;
}
```

响应：

```ts
{
  items: Array<{
    siteKey: string;
    pageKey: string;
    pageUrl: string;
    hitCount: number;
    status: "pending" | "rejected" | "ignored";
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
  };
}
```

### `POST /api/admin/page-registry/pending/approve`

批准待审核未知页面，并将待处理访问量合并到正式页面线程。

请求：

```ts
{
  siteKey: string;
  pageKey: string;
}
```

响应：

```ts
{
  page: SitePageRegistryProjection;
}
```

### `POST /api/admin/page-registry/pending/reject`

拒绝待审核未知页面。

请求：

```ts
{
  siteKey: string;
  pageKey: string;
  reason?: string;
}
```

### `POST /api/admin/page-registry/pending/ignore`

忽略待审核未知页面。

请求：

```ts
{
  siteKey: string;
  pageKey: string;
  reason?: string;
}
```

响应：

```ts
{
  candidate: PendingPageCandidateProjection;
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

删除黑名单规则是解除自动封禁或人工封禁的后台路径；删除后，匹配该规则的公开写入不再因该规则被拒绝，但仍会继续经过页面状态、功能开关、输入长度、验证码、基础限流和后续滥用保护检查。

## Allowlist

白名单规则优先于黑名单和自动黑名单计数：匹配白名单的 IP / email / visitor 不会被现有黑名单拦截，也不会因为公开写入次数触发自动黑名单。白名单不绕过后台认证、CSRF、页面注册状态、页面交互状态、功能开关、必填字段、输入长度、验证码或基础限流。

白名单匹配模式：

- `ip`: `exact` 或 `cidr`
- `email`: `exact` 或 `domain`
- `visitor`: `exact`

Query 列表、创建全局规则或管理全局规则需要对应的 `allowlist.*` 权限。系统管理员和初始管理员可管理全局和任意站点规则；站点管理员只能管理自己有访问权的站点规则；站点评论管理员默认没有白名单管理权限。

### `GET /api/admin/allowlist`

列出白名单规则。

Query：

```ts
{
  siteKey?: string;
  targetType?: "ip" | "email" | "visitor";
  search?: string;
  q?: string;
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}
```

响应：

```ts
{
  items: AdminAllowlistRule[];
  pagination: {
    limit: number;
    offset: number;
    totalCount: number;
  };
}
```

`AdminAllowlistRule`：

```ts
{
  id: number;
  siteId: number | null;
  scope: "post" | "all";
  targetType: "ip" | "email" | "visitor";
  targetValue: string;
  matchMode: "exact" | "cidr" | "domain";
  reason: string | null;
  expiresAt: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### `POST /api/admin/allowlist`

创建白名单规则。

请求：

```ts
{
  siteKey?: string;
  targetType: "ip" | "email" | "visitor";
  matchMode?: "exact" | "cidr" | "domain"; // default "exact"
  targetValue: string;
  scope?: "post" | "all"; // default "all"
  reason?: string;
  expiresAt?: string;
}
```

响应：

```ts
{
  rule: AdminAllowlistRule;
}
```

### `PATCH /api/admin/allowlist/{ruleId}`

更新白名单规则。请求至少包含一个字段；如果更新后的 `targetType` 与 `matchMode` 不兼容，会返回 `ALLOWLIST_MATCH_MODE_INVALID` 或字段级校验错误。

请求：

```ts
{
  targetType?: "ip" | "email" | "visitor";
  matchMode?: "exact" | "cidr" | "domain";
  targetValue?: string;
  scope?: "post" | "all";
  reason?: string | null;
  expiresAt?: string | null;
}
```

响应：

```ts
{
  rule: AdminAllowlistRule;
}
```

### `DELETE /api/admin/allowlist/{ruleId}`

软删除白名单规则。删除后的规则不会再被列表、黑名单跳过或自动黑名单跳过逻辑使用。

响应：

```ts
{
  rule: AdminAllowlistRule;
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
    commenter: {
      replyEmailEnabled: boolean;
      replyEmailDefaultChecked: boolean;
    };
    backend: {
      enabled: boolean;
      events: SiteNotificationEventSettings[];
    };
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

更新站点设置。请求至少包含 `comments`、`pageFeedback`、`engagement`、`pageRegistry`、`notifications` 之一；其中内部字段均可局部提交。`engagement.pageLikes.enabled` 是页面点赞的 canonical 开关，`pageFeedback.allowLike` 仅作为过渡显示字段同步。

Admin Settings API 的 canonical 开关路径：

- 评论：`comments.enabled`
- 评论验证码策略：`comments.captcha.mode`
- 评论投票：`engagement.commentVotes.enabled`
- 页面浏览量：`engagement.pageViews.enabled`
- 页面点赞：`engagement.pageLikes.enabled`
- 访客记录：`engagement.visitors.enabled`
- 页面来源模式：`pageRegistry.mode`
- 权威 sitemap URL 列表：`pageRegistry.authoritativeSitemapUrls`
- 评论者回复邮件通知：`notifications.commenter.replyEmailEnabled`
- 评论框“回复提醒”初始勾选：`notifications.commenter.replyEmailDefaultChecked`
- 后台用户通知：`notifications.backend.enabled`
- 当前站点两类评论通知：`notifications.backend.events`

`pageFeedback.allowLike` 是过渡同步字段；新 UI 和新调用代码应以 `engagement.pageLikes.enabled` 为页面点赞 canonical 开关。

页面来源权威模式说明：

- 公开运行时页面身份只来自允许 `Referer` 的 URL pathname。Canonical Page Key 保留前导 `/`、尾 `/`、大小写和重复斜杠，丢弃 query/hash；请求体或 query 中的 `pageKey` / `pageUrl` 只作为 dev/mock 兼容字段。
- `pageRegistry.mode="discovery"` 时，未登记页面保持发现模式：bootstrap 可写入 pending candidate / pending PV，等待后台审核。
- `pageRegistry.mode="authoritative"` 时，`authoritativeSitemapUrls` 必须至少包含一个当前站点允许 origin 下的 HTTP/HTTPS sitemap URL。
- 权威模式下未知页面默认按 `unknownPageResponse="inactive_payload"` 返回 200 inactive payload，`features.*.enabled=false` 且 `data={}`，不会创建 visitor、visitor metadata、pending candidate、pending PV、page thread、PV、captcha challenge、评论、投票或页面反馈记录。
- `unknownPageResponse="forbidden"` 或 `emergencyLockdown=true` 时，未知页面返回 403 `PAGE_NOT_REGISTERED`，同样不做业务写入。
- 非 active registry page 返回非交互行为或 403 `PAGE_NOT_INTERACTIVE`，公开写入口不会继续创建 visitor、captcha、thread 或业务记录。
- 保存 authoritative 设置会幂等 ensure 一个系统托管受保护的 `page_source_refresh` 任务，`systemKey` 固定为 `page_registry:authoritative_source_refresh:<siteKey>`，payload `sitemapUrls` 与 `pageRegistry.authoritativeSitemapUrls` 保持一致。
- 页面来源 source CRUD 属于 legacy compatibility / 调试入口，不是 authoritative mode 的推荐配置路径。权威模式应通过站点设置中的 `authoritativeSitemapUrls` 管理 sitemap URL。

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
    inputLimits: {
      authorNameMaxLength: number;
      authorWebsiteMaxLength: number;
      pageTitleMaxLength: number;
      pageKeyMaxLength: number;
      contentMaxLength: number;
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
  pageRegistry: {
    mode: "discovery" | "authoritative";
    authoritativeSitemapUrls: string[];
    unknownPageResponse: "inactive_payload" | "forbidden";
    requireHealthySource: boolean;
    sourceFreshnessGraceSec: number;
    emergencyLockdown: boolean;
  };
  notifications: {
    capabilities: {
      mailReady: boolean;
      externalTargetCount: number;
    };
    commenter: {
      replyEmailEnabled: boolean;
      replyEmailDefaultChecked: boolean;
    };
    backend: {
      enabled: boolean;
      events: Array<{
        eventType: "admin_comment_pending" | "admin_comment_approved";
        recipients: Array<{
          userId: number;
          username: string;
          email: string;
          displayName: string;
          includeCommentContent: "none" | "summary" | "full";
        }>;
        externalChannelConfigIds: string[];
      }>;
    };
    channelConfigs: NotificationChannelConfig[];
  };
}
```

`notifications.commenter.replyEmailDefaultChecked` 只控制公开评论框首次渲染时的
初始勾选状态。公开 bootstrap 只有在回复邮件能力实际可用时才返回保存值；能力被任一依赖
关闭时会返回 `defaultChecked=false`。该字段不会代替用户同意，评论创建请求仍必须显式提交
`options.notifyOnReply=true` 才会写入订阅偏好。

`comments.inputLimits` 是公开评论和页面反馈输入长度的站点级运行时上限。默认值为：

```ts
{
  authorNameMaxLength: 40;
  authorWebsiteMaxLength: 2048;
  pageTitleMaxLength: 200;
  pageKeyMaxLength: 512;
  contentMaxLength: 2000;
}
```

保存时会被后端硬上限截断到安全范围内：作者名 `100`、作者网站 / 页面 URL `4096`、页面标题 `500`、页面 key `1024`、评论正文 `10000`。公开 bootstrap 会在 `data.comments.form.limits` 返回当前生效值；公开写入口超过当前站点上限时返回字段级 `VALIDATION_FAILED`。

`comments.abuseGuard.enabled=false` 会关闭 QingYan 应用层的公开写入滥用计数和自动黑名单触发，适用于实例前方已有更强 WAF、反向代理限流或边缘安全策略的部署。`comments.abuseGuard.autoBlacklist.enabled=false` 只关闭自动创建黑名单规则，不影响手动黑名单、验证码策略、基础限流、页面状态或输入校验。`maxWriteActions` 统计评论创建、评论投票和页面点赞等公开写入动作。

评论通知的 canonical 模型是 `notifications.backend.events[]`，并且请求必须同时提交 `admin_comment_pending` 与 `admin_comment_approved` 两个固定事件。PATCH/PUT 输入中的每个事件使用独立的 `recipientUserIds[]` 与 `externalChannelConfigIds[]`；GET 会把人员解析为 `recipients[]`，同时保留已选的其他发送目标编号。示例：

```json
{
  "notifications": {
    "backend": {
      "enabled": true,
      "events": [
        {
          "eventType": "admin_comment_pending",
          "recipientUserIds": [1, 7],
          "externalChannelConfigIds": ["webhook:ops"]
        },
        {
          "eventType": "admin_comment_approved",
          "recipientUserIds": [],
          "externalChannelConfigIds": []
        }
      ]
    }
  }
}
```

人员引用 `admin_users.id`，不使用评论作者邮箱或任意手写邮箱作为长期接收人。全局 `admin` 组用户视为拥有所有站点访问权；其他候选人员必须显式拥有目标站点权限。空的人员和目标数组是有效配置，表示该事件当前不发送，不表示链路损坏。`admin_comment_pending` 在评论进入待审核时创建；直接通过审核的评论创建 `admin_comment_approved`；待审核评论后续通过审核不再追加第二条站点通知。

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

Admin Settings API 的错误响应仍保留 `requestId`、`fields[]` 和 canonical `path`
供日志关联与开发调试；Admin Console 不直接展示这些内部字段，而是把已知场景转换成当前
控件旁的操作提示，未知场景使用不包含内部细节的恢复说明。

### `GET /api/admin/sites/{siteKey}/notification-diagnostics`

按当前数据库中已保存的设置检测三条评论邮件链路。需要有效后台会话、当前站点访问权和
`site_settings.read`。该接口不会创建评论、任务或邮件；Admin Console 中尚未保存的草稿不会
参与结果。

响应：

```ts
{
  generatedAt: string;
  overall: "ready" | "not_sending" | "conditional" | "blocked";
  savedConfigOnly: true;
  runtime: {
    notificationWorker: "ready" | "conditional" | "blocked";
    queueBackend: string;
    lastTickAt: string | null;
  };
  flows: Array<{
    key:
      | "admin_comment_pending_email"
      | "admin_comment_approved_email"
      | "commenter_reply_email";
    status: "ready" | "not_sending" | "conditional" | "blocked";
    recipients: Array<{
      userId?: number;
      displayName?: string;
      email: string;
      status: "ready" | "not_sending" | "conditional" | "blocked";
      notes: string[];
    }>;
    blockers: Array<{
      code: string;
      path?: string;
      message: string;
    }>;
    warnings: Array<{
      code: string;
      path?: string;
      message: string;
    }>;
  }>;
}
```

三条 flow 分别表示“待审核评论 → 站点人员”“直接发布评论 → 站点人员”和
“站点人员回复 → 原评论者”。检测会同时检查系统邮件和 SMTP、通知 worker/队列、站点后台
通知总开关、每个事件选择的站点人员和其他目标、后台用户状态/个人偏好，以及评论者回复能力。
`not_sending` 表示该事件没有目标或总开关已关闭，是有效但不会发送的状态；`blocked`
表示已选择发送但当前配置一定阻断；`conditional` 表示仍需具体评论者邮箱、订阅状态或真实
投递结果才能确认。`path` 仅用于 API 调试，Admin Console 会把它转换为用户可执行的中文提示。

### `POST /api/admin/sites/{siteKey}/notification-chain-tests`

创建一项真实评论邮件链路测试。需要有效后台会话、当前站点访问权和
`site_settings.update`。

请求：

```ts
{
  commenterEmail: string;
}
```

响应：

```ts
{
  runId: string;
  status: "queued";
}
```

该测试使用 QingYan 内置的 `notification_test` 逻辑页面/线程，不要求内容站点创建页面，
也不依赖评论前端。它通过生产 planner、数据库任务、通知 worker、模板渲染器和 email
adapter 执行：

1. 创建评论 A，并按当前站点默认评论状态向该事件选择的站点人员发送真实邮件。
2. 模拟站点人员回复评论 A，并把真实回复提醒发送到 `commenterEmail`。

真实测试只发送 email，不会触发该事件选择的 Webhook 或 WxPusher 目标。测试数据在终态
清理，普通公开/后台评论、页面和统计接口不会显示内部线程；任务和投递证据会保留供排障。
测试可临时准备评论者 opt-in，但不会绕过明确退订或 reputation suppression，终态会恢复原
偏好。每个站点同一时间只允许一个 active run，终态后还有短 cooldown。

请求邮箱无效时返回 `VALIDATION_FAILED`。已保存配置存在阻断项时返回
`NOTIFICATION_CHAIN_TEST_BLOCKED`，详情包含安全的 `blockers[]`；已有测试或仍在 cooldown
时分别返回 `NOTIFICATION_CHAIN_TEST_ACTIVE` 或 `NOTIFICATION_CHAIN_TEST_COOLDOWN`。

### `GET /api/admin/sites/{siteKey}/notification-chain-tests/{runId}`

读取并推进指定真实测试的结果。需要有效后台会话、当前站点访问权和
`site_settings.read`。Admin Console 应在 `checking | queued | running` 时轮询，在任一终态
停止。

响应：

```ts
{
  runId: string;
  status:
    | "checking"
    | "blocked"
    | "queued"
    | "running"
    | "passed"
    | "failed"
    | "timed_out";
  createdAt: string;
  finishedAt: string | null;
  flows: {
    adminComment: NotificationChainTestFlow;
    commenterReply: NotificationChainTestFlow;
  };
  message: string;
}

type NotificationChainTestFlow = {
  status:
    | "checking"
    | "blocked"
    | "queued"
    | "running"
    | "passed"
    | "failed"
    | "timed_out";
  taskIds: string[];
  deliveries: Array<{
    deliveryId: string;
    recipient: string;
    status: string;
    providerMessageId?: string;
    error?: {
      kind: string;
      message: string;
    };
  }>;
};
```

`passed` 和 delivery `sent` 只表示邮件服务商已接受发送请求，不证明邮件已进入收件箱。
最终验收仍需核对站点人员收件箱和 `commenterEmail` 收件箱；同时检查垃圾邮件、服务商
退信和延迟投递。终态轮询不会重复写 completed/failed 审计。

## System Settings

### `GET /api/admin/system-settings`

获取全局系统设置。secret 明文不会返回，只返回 `*Configured` 状态。

响应：

```ts
AdminSystemSettings
```

### `PUT /api/admin/system-settings`

更新全局系统设置。`logging` 当前为必填；`admin`、`mail`、`notifications`、`captcha`、`ipRegion`、`avatar`、`publicApi` 可按后台表单提交。secret 字段为空时前端会省略，后端保留已有值。

`mail.enabled` 和 `mail.smtp.*` 是 system owner，影响实例级邮件发送能力。站点级通知设置拆分为 `notifications.commenter.replyEmailEnabled` 和 `notifications.backend.enabled`：前者只控制普通评论者回复邮件订阅能力，后者只控制后台用户通知任务创建。

`notifications.delivery.queueBackend` 默认是 `database`。选择 `bullmq` 时需要部署 Redis 并配置相应运行环境；BullMQ 只影响队列后端，不改变 planner、delivery projection、worker 状态模型或任务中心展示。

Webhook 和 WxPusher 的 canonical 配置模型是 `notifications.channelConfigs[]`。每个元素是一条实例级发送目标，例如 `webhook:feishu`、`webhook:ops`、`wxpusher:audit`；站点设置再通过事件的 `externalChannelConfigIds[]` 选择目标。`email:default` 是只读默认邮件实例，GET 会返回，PUT 可原样带回但不会作为可编辑实例落库。Webhook/WxPusher 的 `secretConfig.secret`、`secretConfig.appToken` 是 secret 字段，GET 响应只返回 `secretConfigured` 状态；PUT 省略或提交空 `secretConfig` 会保留已有密钥。

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

## Task Scheduler

任务调度中心接口服务内置 Admin Console，不进入公开 OpenAPI。所有写操作需要已登录后台会话和 CSRF token；后端按当前用户的全局管理员、初始管理员、站点管理员、站点评论管理员和站点授权执行 ACL，不以前端隐藏作为权限边界。

任务调度中心只允许后端注册的内置 task type，不支持任意 Shell、Python、JavaScript、SQL、系统命令、容器命令或脚本库任务。

### `GET /api/admin/tasks/definitions`

列出后端权威 task type registry。

响应：
```ts
{
  items: Array<{
    type: string;
    label: string;
    description: string;
    category: "notification" | "import" | "maintenance" | "backup" | "upgrade" | "page" | "system";
    scope: "global" | "site" | "multi_site" | "page";
    defaultPayload: Record<string, unknown>;
    defaultPolicy: {
      maxAttempts?: number;
      retryDelaySec?: number;
      timeoutMs?: number;
      maxBytes?: number;
      concurrencyKey?: string;
    };
    schedule: {
      manual: boolean;
      presets: string[];
      cron: boolean;
      condition: boolean;
    };
    dangerous: boolean;
    reuse: {
      service: string;
      method: string;
      file: string;
    };
  }>;
}
```

当前内置 task type 包括：

- `page_source_refresh`
- `page_metadata_refresh`
- `comment_ip_refresh`
- `ip_region_update`
- `backup`
- `site_settings_action`
- `blacklist_automation`
- `daily_site_digest`

### `GET /api/admin/tasks/scheduled`

列出当前用户可见的计划任务定义。非 owner 的站点管理员和站点评论管理员只能看到摘要投影，不能看到 raw payload、policy、trigger 或日志。

响应：
```ts
{
  items: ScheduledTaskProjection[];
  totalCount: number;
}
```

### `POST /api/admin/tasks/scheduled`

创建计划任务定义。危险 task type 必须先以 `enabled=false` 创建；如果请求里传入 `enabled=true`，后端返回 `VALIDATION_FAILED`，字段路径为 `enabled`。

请求：
```ts
{
  name: string;
  description?: string | null;
  type: string;
  siteKey?: string | null;
  scopeKind: "global" | "site" | "multi_site" | "page";
  scope: Record<string, unknown>;
  enabled: boolean;
  scheduleKind: "manual_only" | "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";
  schedulePreset?: string | null;
  cronExpression?: string | null;
  timezone?: string | null;
  payload: Record<string, unknown>;
  policy: {
    maxAttempts?: number;
    retryDelaySec?: number;
    timeoutMs?: number;
    maxBytes?: number;
    concurrencyKey?: string;
    failureNotification?: {
      enabled: boolean;
      channelConfigIds: string[];
      recipientIds: string[];
    };
  };
  trigger: {
    runAt?: string;
    everyMinutes?: number;
    time?: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
  };
  retentionCount: number;
}
```

响应为 `ScheduledTaskProjection`。

### `GET /api/admin/tasks/scheduled/{taskId}`

读取单个计划任务定义。无可见权限时返回 `SCHEDULED_TASK_NOT_FOUND`；摘要可见但无管理权限时，响应不包含 raw payload/policy/trigger。

### `PATCH /api/admin/tasks/scheduled/{taskId}`

更新计划任务定义。只有 owner、初始管理员或具备全局管理权限的管理员可以更新。

### `DELETE /api/admin/tasks/scheduled/{taskId}`

删除计划任务定义并写入删除快照。历史 run 不会被删除；普通任务管理 UI 不提供恢复入口。

请求：
```ts
{
  reason?: string | null;
}
```

响应为 `ScheduledTaskDeletedSnapshot`。

### `POST /api/admin/tasks/scheduled/{taskId}/run`

立即创建一次手动运行记录。该接口只创建 `task_runs` 记录并写审计；执行由后端任务 runner/worker 后续处理。

响应为 `TaskRunProjection`，owner 和管理员可见 raw input；摘要用户只能看到脱敏投影。

### `POST /api/admin/tasks/scheduled/{taskId}/enable`

启用计划任务定义。任务 owner 权限变化导致自动停用后，需要具备管理权限的用户手动重新启用。

### `POST /api/admin/tasks/scheduled/{taskId}/disable`

禁用计划任务定义。

请求：
```ts
{
  reason: string;
}
```

### `POST /api/admin/tasks/scheduled/{taskId}/transfer-owner`

转移任务 owner。目标用户必须处于 active 状态，并具备目标任务作用范围所需权限；初始管理员可接管所有任务。

请求：
```ts
{
  ownerUserId: number;
}
```

### `POST /api/admin/tasks/owners/reconcile`

管理员或初始管理员用于处理 owner 被停用、删除、降权或失去站点权限后的任务。匹配的任务会自动 disabled，并转移给初始管理员。

请求：
```ts
{
  ownerUserId: number;
  reason: "owner_permission_changed" | "owner_disabled" | "owner_deleted" | string;
}
```

响应：
```ts
{
  updatedTaskIds: string[];
}
```

### `GET /api/admin/tasks/runs`

列出任务运行记录。

响应：
```ts
{
  items: TaskRunProjection[];
  totalCount: number;
}
```

### `GET /api/admin/tasks/runs/{runId}`

读取单个任务运行记录。非 owner 摘要用户不能看到 raw input/output/error。

### `GET /api/admin/tasks/runs/{runId}/events`

分页读取任务事件日志。只有具备日志权限的用户可以访问；站点摘要用户默认不能访问事件日志。显式标记 `visibleToSiteAdmin=true` 的事件仍需经过后端权限投影和脱敏。

响应：
```ts
{
  items: Array<{
    id: string;
    taskRunId: string;
    eventType: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    data: unknown;
    visibleToSiteAdmin: boolean;
    createdAt: string;
  }>;
  totalCount: number;
}
```

### `GET /api/admin/tasks/runs/{runId}/logs`

按 sequence 增量读取任务 console 日志。任务详情 console 使用该接口轮询 stdout/stderr/system 日志流；只有具备日志权限的用户可以访问。

Query：

```ts
{
  afterSequence?: number;
  limit?: number; // default 100, max 500
}
```

响应：

```ts
{
  items: TaskRunLogLine[];
  nextSequence: number;
  hasMore: boolean;
}
```

### `POST /api/admin/tasks/runs/{runId}/cancel`

取消任务运行记录。当前实现写入 `cancelled` 状态和 `TASK_RUN_CANCELLED` 错误快照。

### `POST /api/admin/tasks/runs/{runId}/retry`

把任务运行记录标记为 `retrying`，并写入 `TASK_RUN_RETRY_REQUESTED` 错误快照。

### `GET /api/admin/tasks/audit`

列出任务相关审计记录。初始管理员和管理员可见全局任务审计；站点用户只能看到其授权站点范围内的任务审计摘要。

### `GET /api/admin/tasks/deleted-snapshots`

列出计划任务删除快照。仅初始管理员可访问。

### `GET /api/admin/tasks/deleted-snapshots/{snapshotId}`

读取单个计划任务删除快照。仅初始管理员可访问。

`ScheduledTaskProjection`：
```ts
{
  id: string;
  name: string;
  description: string | null;
  type: string;
  siteId: number | null;
  scopeKind: string;
  enabled: boolean;
  disabledReason: string | null;
  scheduleKind: string;
  schedulePreset: string | null;
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: string | null;
  ownerUserId: number;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canRun: boolean;
  canViewLogs: boolean;
  visibility: "summary" | "definition";
  scope?: unknown;
  payload?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  retentionCount?: number;
}
```

`TaskRunProjection`：
```ts
{
  id: string;
  scheduledTaskId: string | null;
  scheduledTaskNameSnapshot: string | null;
  type: string;
  category: "notification" | "import" | "maintenance" | "backup" | "upgrade" | "page" | "system";
  status: "queued" | "delayed" | "running" | "retrying" | "succeeded" | "failed" | "skipped" | "blocked" | "suppressed" | "cancelled";
  siteId: number | null;
  siteKey: string | null;
  scopeKind: string | null;
  trigger: string | null;
  ownerUserIdSnapshot: number | null;
  createdByUserId: number | null;
  skipReason: string | null;
  blockReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  canViewLogs: boolean;
  visibility: "run_summary" | "run_detail";
  scope?: unknown;
  triggerSnapshot?: unknown;
  input?: unknown;
  actionConfigSnapshot?: unknown;
  payloadSummary?: unknown;
  payload?: unknown;
  progress?: unknown;
  result?: unknown;
  error?: unknown;
  attempts?: number;
  maxAttempts?: number;
  retryDelaySec?: number;
  priority?: number;
  concurrencyKey?: string | null;
  workerId?: string | null;
  lockConflictWithRunId?: string | null;
  lockConflictWithTaskName?: string | null;
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
    entry: "compose-script";
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
  executor: "./scripts/update.sh";
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

任务中心列表。该接口只读取 `task_runs` 投影；导入任务仍由 import-export job API 管理。

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
