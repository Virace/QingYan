# QingYan Admin Entities And Comment Require Design

## 背景

当前 `QingYan` 已经有可用的 `/admin` 后台基线，支持管理员验证码登录、评论管理、黑名单管理和运行时设置，也已经把评论验证码阈值语义统一成“从第 N 次写操作开始要求验证码”。

但后台仍缺少更完整的运营视图：

- 评论管理还没有跳转真实页面的能力
- 还没有页面管理、用户管理、访客管理、站点管理
- 运行时设置展示范围偏小
- 评论身份字段的产品语义仍然偏静态，目前更像若干散落布尔开关，而不是前端可直接消费的动态要求集合

同时，用户已经明确新的产品语义：

1. “匿名评论”表示没有传统登录体系，不表示可以不填身份字段
2. 当前可用身份字段先只有 `nickname`、`email`、`website`
3. 哪些字段必填，交给 `require: string[]` 决定
4. 用户管理以邮箱为主键，同一邮箱可能对应多个昵称
5. 处于项目开发阶段，不需要保留兼容层，直接切到新契约，同时同步更新 API 文档

## 目标

1. 扩展后台导航，新增页面管理、用户管理、访客管理、站点管理
2. 扩展评论管理，使其显示作者邮箱并可跳转真实页面
3. 将评论身份字段契约切到 `require: string[]`
4. 让 bootstrap 返回 `require` 数组，供前端动态决定字段是否必填
5. 扩展运行时设置页，覆盖当前可进入 `runtime_settings` 的更多字段
6. 同步更新配置文档和 OpenAPI，使新契约成为唯一正式事实来源

## 非目标

- 不引入传统账号注册/登录体系
- 不新增后台管理员账号系统
- 不新增作者实体表或做历史数据迁移
- 不把后台变成通用 CMS
- 不做站点 CRUD、页面删除、用户合并/拆分

## 核心决策

### 1. 不保留兼容层，直接切到 `require: string[]`

评论身份字段的正式契约直接切为：

- `require: string[]`

当前只允许三个 key：

- `nickname`
- `email`
- `website`

项目开发阶段不保留兼容层，不再把 `requireEmail` / `requireName` 作为对外正式契约保留。实现与文档都直接切到数组形态。

### 2. “匿名评论”是免账号门槛，不是免身份字段

统一定义如下：

`匿名评论 = 不需要注册或登录账号，但仍按当前站点 require 规则提供身份字段。`

因此：

- `require = ["nickname", "email"]` 时，昵称和邮箱必填
- `require = ["nickname"]` 时，仅昵称必填
- `require = []` 时，允许彻底匿名

这里的“匿名”只描述没有传统账号体系，不描述字段是否必填。

### 3. 用户管理只统计有邮箱的评论作者

用户管理采用按邮箱聚合的作者视图：

- 邮箱是用户主键
- 同一邮箱下允许有多个昵称
- 没有邮箱的评论不进入“用户管理”
- 没有邮箱的评论仍可出现在评论管理、页面管理和访客管理中

因此“用户”和“访客”是两层概念：

- 用户：业务身份视角，按邮箱聚合
- 访客：技术访问视角，按 `visitorKey` 聚合

### 4. 后台页面先做管理视图，不做高风险主数据编辑器

新增后台模块优先提供：

- 列表
- 详情 / 聚合统计
- 过滤
- 跳转
- 和已有黑名单、运行时设置的联动入口

不在本轮中新增大范围主数据写接口。

## 评论身份字段设计

### 配置与运行时形态

评论身份字段使用 `require: string[]` 表达必填集合。

站点默认配置与运行时设置都遵循这一形态，例如：

```yaml
comments:
  identity:
    require:
      - nickname
      - email
    allow:
      - nickname
      - email
      - website
```

当前 `allow` 也可以不显式入配置，默认固定为三项：

- `nickname`
- `email`
- `website`

但对外返回给前端时，建议把 `allow` 和 `require` 都带出，保证未来加字段时不用再改 bootstrap 结构。

### Bootstrap 返回契约

bootstrap 需要补充评论身份字段描述，至少包含：

```json
{
  "commentForm": {
    "allow": ["nickname", "email", "website"],
    "require": ["nickname", "email"]
  }
}
```

前端据此动态处理：

- 显示哪些字段
- 哪些字段标记为 required

这轮不把 bootstrap 扩成复杂 schema，只返回足够稳定的数组契约。

### 评论创建校验

评论创建写入逻辑需要改成按 `require` 判定，而不是写死某个字段：

- `nickname` 在 `require` 中时，`author.name` 必填
- `email` 在 `require` 中时，`author.email` 必填
- `website` 在 `require` 中时，`author.website` 必填

当前只有这三类映射，不做通用字段引擎。

## 后台模块拆分

### 评论管理

评论管理页保留现有审核能力，并补充：

- 作者邮箱显示
- 页面标题显示
- 真实页面链接（优先 `pageUrl`）
- 只看该页面评论的快捷过滤入口

展示字段建议为：

- 作者昵称
- 作者邮箱
- 页面标题
- `pageKey`
- 真实页面链接
- 状态
- 置顶 / 折叠状态
- 创建时间

操作维持：

- 审核通过 / 设为待审
- 置顶 / 取消置顶
- 折叠 / 展开
- 删除

### 页面管理

页面管理基于 `page_threads` 做聚合运营视图，展示：

- `siteKey`
- `pageKey`
- `pageTitle`
- `pageUrl`
- `commentCount`
- `rootCommentCount`
- `pageLikeCount`
- `updatedAt`

页面管理支持：

- 打开真实页面
- 跳到该页面评论列表
- 查看该页面关联用户数
- 查看该页面关联访客数

本轮不提供页面删除或页面主数据编辑。

### 用户管理

用户管理以 `comments.authorEmail` 为主键做聚合，展示：

- 邮箱
- 关联昵称集合
- 评论总数
- 待审评论数
- 已发布评论数
- 最近活跃时间
- 关联页面数
- 关联站点数
- 是否命中过邮箱黑名单

支持动作：

- 查看该邮箱的全部评论
- 查看该邮箱用过的昵称
- 将该邮箱加入黑名单
- 从该邮箱反查关联访客记录

### 访客管理

访客管理基于 `visitors`，展示：

- `visitorKey`
- `siteKey`
- 最近活跃时间
- 关联评论数
- 关联页面数
- 关联邮箱数
- 是否命中过访客 / IP 黑名单

支持动作：

- 查看该访客的全部评论
- 查看该访客关联过的邮箱
- 加入访客黑名单
- 加入 IP 黑名单

### 站点管理

站点管理先做总览和入口页，展示：

- `siteKey`
- `name`
- `allowedOrigins`
- 评论是否启用
- 评论默认状态
- 评论身份 `require`
- 验证码模式
- 页面点赞开关
- 邮件通知开关
- 当前页面数
- 当前评论数
- 当前用户数
- 当前访客数

站点页负责：

- 查看 config-only 字段
- 跳转到运行时设置
- 跳转到页面管理 / 用户管理 / 访客管理

不在本轮直接编辑 YAML 中的站点主数据。

## 运行时设置扩展

运行时设置页本轮应覆盖当前能进入 `runtime_settings` 的主要字段：

- `comments.enabled`
- `comments.defaultStatus`
- `comments.maxDepth`
- `comments.rootLimit`
- `comments.allowWebsite`
- `comments.identity.require`
- `comments.captcha.mode`
- `comments.captcha.thresholdWindowSec`
- `comments.captcha.thresholdMaxActions`
- `comments.abuseGuard.enabled`
- `comments.abuseGuard.windowSec`
- `comments.abuseGuard.maxWriteActions`
- `comments.abuseGuard.autoBlacklist.enabled`
- `comments.abuseGuard.autoBlacklist.scope`
- `comments.abuseGuard.autoBlacklist.ttlSec`
- `pageFeedback.allowLike`
- `notifications.emailEnabled`

其中 `comments.identity.require` 是本轮新增的关键设置项。

## API 设计范围

建议新增以下 admin API：

- `GET /api/admin/pages`
- `GET /api/admin/users`
- `GET /api/admin/visitors`
- `GET /api/admin/sites`

必要时补充查询参数：

- `siteKey`
- `pageKey`
- `email`
- `visitorKey`
- `search`
- `limit`
- `offset`

这些 API 第一版以只读聚合为主，不新增高风险写操作。

## 前端交互设计

后台导航扩展为：

- 评论管理
- 页面管理
- 用户管理
- 访客管理
- 黑名单
- 站点管理
- 运行时设置

交互规则：

- 评论管理中页面标题点击后新标签打开真实 `pageUrl`
- 页面管理中页面标题同样可跳真实页面
- 用户管理点击邮箱可过滤评论列表
- 站点切换继续作为所有页面的顶层筛选维度

## 测试策略

### 1. 评论身份字段回归

新增或更新测试，覆盖：

- `require = ["nickname", "email"]` 时，两者必填
- `require = ["nickname"]` 时，仅昵称必填
- `require = []` 时，允许彻底匿名
- bootstrap 返回 `require` 数组

### 2. 管理聚合查询测试

新增 repository / service / integration tests，覆盖：

- 页面管理列表
- 用户管理按邮箱聚合
- 同一邮箱下多个昵称聚合
- 访客管理列表
- 站点管理总览

### 3. 后台页面 smoke

扩展 `/admin` 页面 smoke，确认：

- 新增导航页可切换
- 评论列表显示作者邮箱
- 评论页能跳转真实页面
- 设置页可显示并保存 `require`

### 4. 文档同步验证

完成后需同步更新：

- `docs/openapi.yaml`
- `docs/configuration.md`
- 相关 README / spec / plan

## 验收标准

完成后应满足：

1. 评论身份字段正式契约切到 `require: string[]`
2. bootstrap 返回 `require` 数组
3. 评论管理显示作者邮箱并可跳转真实页面
4. 页面管理可查看真实页面聚合信息并跳转前台页面
5. 用户管理以邮箱为主键聚合，支持多个昵称
6. 没邮箱的评论不会进入用户管理，但仍可出现在评论/页面/访客视图
7. 站点管理可展示站点总览和运行时能力入口
8. 运行时设置页覆盖更多当前可调字段，包括 `require`
9. API 文档和配置文档同步更新
