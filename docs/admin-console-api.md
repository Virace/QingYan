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
    userCount: number;
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

## Pages, Users, Visitors

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
  pageTitle: string | null;
  pageUrl: string | null;
  commentCount: number;
  rootCommentCount: number;
  pageLikeCount: number;
  updatedAt: string;
  visitorCount: number;
  userCount: number;
}
```

### `GET /api/admin/users`

按邮箱聚合的用户视图。单项结构：

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
}
```

`email` 是 trim + lower-case 后的聚合键；`emailVariants` 保留该聚合组中出现过的原始邮箱写法。搜索邮箱时同样按归一化值匹配，因此 `Virace@aliyun.com` 和 `virace@aliyun.com` 会归到同一个用户视图。

### `GET /api/admin/visitors`

按 visitor key 聚合的访客视图。单项结构：

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
        blogUrl?: string;
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
  };
  pageCount: number;
  commentCount: number;
  userCount: number;
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

更新站点设置。请求至少包含 `comments`、`pageFeedback`、`notifications` 之一；其中内部字段均可局部提交。

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
        blogUrl?: string;
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
  notifications: {
    emailEnabled: boolean;
  };
}
```

## System Settings

### `GET /api/admin/system-settings`

获取全局系统设置。secret 明文不会返回，只返回 `*Configured` 状态。

响应：

```ts
AdminSystemSettings
```

### `PUT /api/admin/system-settings`

更新全局系统设置。`logging` 当前为必填；`admin`、`mail`、`captcha`、`ipRegion`、`avatar` 可按后台表单提交。secret 字段为空时前端会省略，后端保留已有值。

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
    gravatar: {
      enabled: boolean;
      baseUrl: string;
      size: number;
      defaultImage:
        | "404"
        | "mp"
        | "identicon"
        | "monsterid"
        | "wavatar"
        | "retro"
        | "robohash"
        | "blank";
      rating: "g" | "pg" | "r" | "x";
      forceDefault: boolean;
    };
    display: {
      shape: "circle" | "rounded" | "square";
      sizePx: number;
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
