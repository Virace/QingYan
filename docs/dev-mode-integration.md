# QingYan Dev Mode 联调指南

本文档面向 `FangYuan` 之类的下游前端与自动化测试调用方，说明 `QingYan` 在 dev mode 下的控制接口、真实业务联调流程、错误处理方式，以及前端 UI 应如何接这些状态。

## 为什么不放进 OpenAPI

当前 `/api/dev/*` **不会出现在** `docs/openapi.yaml`、`/openapi.json` 和 `/docs` 中。

原因不是“接口不重要”，而是边界不同：

- OpenAPI 只描述正式对外的业务契约
- `/api/dev/*` 只在 dev mode 下存在
- 生产环境不会暴露 `/api/dev/*`
- `/api/dev/*` 的职责是“控制真实后端状态”，不是正式产品功能

所以它更适合作为一份专门的联调 / 自动化文档保留，而不是和正式 API 混在一起。

## 总体原则

dev mode 的核心原则只有两条：

1. **业务 API 不变**
   - 仍然使用 `/api/*` 和 `/admin`
   - 下游不要切换到另一套 “mock 业务路由”

2. **控制面单独存在**
   - 只新增 `/api/dev/*`
   - `/api/dev/*` 用来把真实系统推到指定状态
   - 真正的数据读取、评论创建、点赞、验证码验证，仍然走正式业务 API

## 启动条件

### 服务端

启动 `QingYan` 时开启 dev mode：

```bash
QINGYAN_DEV_MODE=true pnpm dev
```

可选环境变量：

```bash
QINGYAN_DEV_ADMIN_TOKEN=dev-token
QINGYAN_DEV_ALLOWED_ORIGIN=http://localhost:4321
```

只需要运行内置 mock、发布前验证部署链路或给下游前端做无数据库联调时，可使用：

```bash
QINGYAN_DATABASE_MODE=none QINGYAN_DEV_ADMIN_TOKEN=dev-token pnpm dev
```

无数据库模式会自动启用 dev mode，不连接 SQLite，也不要求先执行迁移。它仍然提供 `/api/dev/*` 控制面、`/api/*` 前台业务接口，以及用于自动化联调的最小后台会话接口。mock 状态只保存在运行时内存中，进程重启后会重置。

### dev mode 的固定语义

开启后，系统自动进入以下语义：

- 只提供一个开发站点：`default`
- 前端仍然必须显式传 `siteKey: "default"`
- 页面维度继续使用真实 `pageKey`
- 真实业务 API 路径保持不变
- 只额外挂载 `/api/dev/*`

## 接口总览

### 1. `POST /api/dev/session`

用途：用 dev token 换取正常的后台管理员会话。

它会创建正常的 `qingyan_admin` cookie。后续：

- `/api/dev/*`
- `/api/admin/*`
- `/admin`

都走同一套后台权限边界。

请求体：

```json
{
  "token": "dev-token"
}
```

成功响应：

```json
{
  "authenticated": true,
  "session": {
    "expiresAt": "2026-04-18T12:34:56.000Z"
  }
}
```

常见错误：

- `401 DEV_AUTH_REQUIRED`：token 不对
- `404`：当前服务不是 dev mode

### 2. `GET /api/dev/state`

用途：观察某个页面、某个 visitor 的当前真实状态。

请求参数：

- `siteKey=default`
- `pageKey=<目标页面 key>`
- `visitorKey=<可选，建议在观察 public visitor 时显式传>`

示例：

```text
GET /api/dev/state?siteKey=default&pageKey=post:threshold-demo&visitorKey=visitor_xxx
```

返回结构示例：

```json
{
  "siteKey": "default",
  "pageKey": "post:threshold-demo",
  "visitorKey": "visitor_xxx",
  "thread": {
    "commentCount": 0,
    "rootCommentCount": 0,
    "pageLikeCount": 0
  },
  "captcha": {
    "required": true,
    "verified": false,
    "mode": "inline_value",
    "challenge": {
      "challengeId": "cap_xxx",
      "mode": "inline_value",
      "imageData": "data:image/svg+xml;base64,..."
    }
  }
}
```

#### 什么时候必须传 `visitorKey`

如果你想观察“前台真实访客”的验证码状态，**建议总是传 `visitorKey`**。

因为验证码上下文是按：

- 同一站点
- 同一页面
- 同一访客

组织的。后台管理员自己的会话上下文不等于前台访客上下文。

### 3. `POST /api/dev/reset`

用途：清空某个页面的开发态，回到干净基线。

请求体：

```json
{
  "siteKey": "default",
  "pageKey": "post:demo-reset"
}
```

成功响应：

```json
{
  "ok": true
}
```

目前 reset 会清掉当前页面相关的：

- 评论
- 投票
- 页面点赞记录
- 页面浏览记录
- 验证码会话
- 页面线程数据

并把站点的 runtime settings 恢复到当前 dev 站点默认值。

### 4. `POST /api/dev/scenario`

用途：把真实系统推到指定场景。

请求体：

```json
{
  "siteKey": "default",
  "pageKey": "post:demo",
  "scenario": "comments-captcha-always",
  "pageTitle": "Demo Page",
  "pageUrl": "https://example.test/posts/demo"
}
```

当前支持的场景：

- `comments-captcha-always`
- `comments-threshold-next-write`
- `comments-seeded-thread`

成功响应：

```json
{
  "ok": true,
  "scenario": "comments-captcha-always"
}
```

## 正式业务 API 仍然怎么用

这一点最重要：**下游联调时，正式业务 API 的接法不因为 dev mode 而变化。**

仍然使用：

- `GET /api/comments/bootstrap`
- `GET /api/comments/thread`
- `POST /api/comments`
- `POST /api/comments/:commentId/vote`
- `GET /api/comments/captcha/state`
- `POST /api/comments/captcha/verify`
- `POST /api/page-feedback/like`

以及：

- `GET /admin`
- `/api/admin/*`

## 下游接入流程

下面给的是推荐流程，直接对应前端如何组织 UI 和状态。

---

## Flow 1: `always` 验证码

适用场景：页面一打开就必须先展示验证码。

### 先准备场景

```http
POST /api/dev/session
POST /api/dev/reset
POST /api/dev/scenario
```

其中 scenario：

```json
{
  "siteKey": "default",
  "pageKey": "post:always-demo",
  "scenario": "comments-captcha-always",
  "pageTitle": "Always Demo",
  "pageUrl": "https://example.test/posts/always-demo"
}
```

### 前端正式调用顺序

1. `GET /api/comments/bootstrap`
2. 读取 `captcha.required`
3. 如果 `required === true` 且 `challenge !== null`
   - 直接展示验证码 UI
   - `<img src={challenge.imageData}>`
4. 用户输入答案后，调用 `POST /api/comments/captcha/verify`
5. 校验成功后，再调用：
   - `POST /api/comments`
   - 或 `POST /api/comments/:commentId/vote`
   - 或 `POST /api/page-feedback/like`

### UI 处理建议

- 评论表单不要先隐藏
- 验证码面板应直接挂在当前写操作附近
- 用户输入内容不要因为验证码展示而被清空
- 校验成功后，保留原始表单内容，直接继续原来的写操作

### 错误处理

- `400 COMMENT_CAPTCHA_INVALID`
  - 展示“验证码错误”
  - 保持当前 challenge
  - 允许用户继续输入答案重试

- `400 COMMENT_CAPTCHA_REQUIRED`
  - 说明当前 challenge 丢了、visitor 变了，或上下文不匹配
  - 重新拉 `captcha/state`

---

## Flow 2: `threshold` 验证码

适用场景：页面初始化不弹验证码，而是在某次写操作时开始要求验证码。

### 先准备场景

```json
{
  "siteKey": "default",
  "pageKey": "post:threshold-demo",
  "scenario": "comments-threshold-next-write"
}
```

### 前端正式调用顺序

1. **先走一次 `GET /api/comments/bootstrap`**
   - 这一步不是装饰性的
   - 它会建立 `qingyan_visitor` cookie
2. 用户正常点击提交评论 / 点赞 / 投票
3. 写接口第一次返回：
   - `400 COMMENT_CAPTCHA_REQUIRED`
   - 或 `400 VOTE_CAPTCHA_REQUIRED`
4. 前端收到这个错误后：
   - 立即调用 `GET /api/comments/captcha/state`
5. 从返回里拿到 `challenge.imageData`
6. 展示验证码 UI
7. 用户输入答案后调用 `POST /api/comments/captcha/verify`
8. 成功后重试刚才失败的写操作

### 这里最容易踩坑的点

**不要跳过第一次 `bootstrap`。**

如果前端没先建立 `qingyan_visitor` cookie，后面即使服务端在第一次写操作时创建了 challenge，下游自己再去 `captcha/state` 时也可能因为 visitor 上下文变了而拿不到 challenge。

也就是说：

- `threshold` 模式下
- “先 bootstrap，再第一次写，再 captcha/state”
- 这是推荐且稳定的真实联调顺序

### UI 处理建议

- 正常态不展示验证码区域
- 只有收到 `*_CAPTCHA_REQUIRED` 错误码时再展开验证码 UI
- 评论内容、点赞意图、投票意图都要保留，待验证成功后自动重试

---

## Flow 3: seeded thread

适用场景：下游需要直接做评论列表、回复树、点赞态的 UI 联调。

### 准备场景

```json
{
  "siteKey": "default",
  "pageKey": "post:seeded-demo",
  "scenario": "comments-seeded-thread",
  "pageTitle": "Seeded Demo",
  "pageUrl": "https://example.test/posts/seeded-demo"
}
```

### 之后怎么读

直接调：

```http
GET /api/comments/bootstrap
```

当前 seeded thread 会提供：

- 2 条评论
- 1 条 root
- 1 条 reply
- 1 个页面点赞

适合拿来联调：

- 评论列表
- 嵌套回复树
- 页面点赞展示
- 评论作者信息展示

---

## 推荐的前端状态管理方式

### 1. 业务状态与 dev 控制状态分离

前端里建议分两个层次：

- **业务状态**
  - bootstrap 结果
  - comments 列表
  - captcha 状态
  - pending draft
  - page feedback

- **dev 控制状态**
  - 当前是否处于 dev mode
  - 当前调用了哪个 `/api/dev/scenario`
  - 当前 `visitorKey`
  - 当前 `qingyan_admin` 是否就绪

不要把 `/api/dev/*` 结果和正式业务数据结构揉成一个 model。

### 2. 始终保留 draft

验证码插入流程里，最重要的是：

- 评论输入内容不要丢
- 点赞 / 投票意图不要丢
- 校验成功后自动继续原动作

前端不应该把验证码当成“另一套表单”，而应该把它看成当前写操作的一个中间状态。

### 3. 显示 challenge 的方式

后端返回的是：

```json
{
  "imageData": "data:image/svg+xml;base64,..."
}
```

前端直接：

```html
<img src=\"...\" alt=\"验证码\" />
```

不需要自己重绘或生成验证码样式。

## 错误处理建议

### dev 控制面

- `401 DEV_AUTH_REQUIRED`
  - `/api/dev/session` 的 token 不对

- `401 ADMIN_AUTH_REQUIRED`
  - 调用了 `/api/dev/state`、`/api/dev/reset`、`/api/dev/scenario`
  - 但没有先建立 `qingyan_admin` session

- `404`
  - 当前不是 dev mode
  - 或生产环境中调用了 `/api/dev/*`

### 正式业务面

- `400 COMMENT_CAPTCHA_REQUIRED`
  - 当前必须进入验证码流程

- `400 VOTE_CAPTCHA_REQUIRED`
  - 当前投票必须进入验证码流程

- `400 COMMENT_CAPTCHA_INVALID`
  - 当前 challenge 存在，但答案错误

- `429`
  - 验证码尝试过多或写操作过于频繁

## 给下游的最小调用清单

### 先建 admin 会话

```http
POST /api/dev/session
Content-Type: application/json

{
  "token": "dev-token"
}
```

### always 场景

```http
POST /api/dev/reset
POST /api/dev/scenario
GET  /api/comments/bootstrap
POST /api/comments/captcha/verify
POST /api/comments
```

### threshold 场景

```http
POST /api/dev/reset
POST /api/dev/scenario
GET  /api/comments/bootstrap
POST /api/comments
GET  /api/comments/captcha/state
POST /api/comments/captcha/verify
POST /api/comments
```

### seeded thread 场景

```http
POST /api/dev/reset
POST /api/dev/scenario
GET  /api/comments/bootstrap
```

## 当前已验证的真实行为

以下行为已经在本地真实 dev server 上跑通过：

- `/api/dev/session` 可创建正常后台会话
- `/api/admin/session/me` 与 `/api/admin/sites` 在 dev mode 下只返回 `default`
- `comments-captcha-always` 能通过真实 `bootstrap` 返回 challenge
- `comments-threshold-next-write` 在“先 bootstrap 拿 visitor cookie”后，会在第一次写操作时报 `COMMENT_CAPTCHA_REQUIRED`
- `visitorKey` 传给 `/api/dev/state` 后，能观察目标 public visitor 的真实验证码状态
- `comments-seeded-thread` 能通过真实 `bootstrap` 读到 seeded 评论树和页面点赞

## 结论

如果下游要做的是“更好地处理前端 UI”，正确做法不是自己实现一套假的 mock 业务接口，而是：

1. 用 `/api/dev/*` 把真实系统推到指定状态
2. 用正式业务 API 读取和写入
3. 按正式错误码驱动 UI 流程

这样下游联调到的就不是“像真的”，而是“就是真的”。
