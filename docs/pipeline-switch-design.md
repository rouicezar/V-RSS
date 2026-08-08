# 采集管线切换设计

## 数据模型

### `accounts.pipeline`

- `1`：方案1（`.xyz`）账号。
- `2`：方案2（自有公众号后台）账号。
- 既有账号迁移时默认为 `1`，与当前实际数据一致。

### `mp_state.active_pipeline`

- 全局当前方案，值为 `1` 或 `2`。
- 默认值为 `1`。
- 复用现有唯一行 `id = 'daily'`，由 `RateLimiter.restore()` 在启动时恢复。

## 后端路由

`TrpcService` 作为唯一分发点：

| 操作       | 方案1                                        | 方案2                                             |
| ---------- | -------------------------------------------- | ------------------------------------------------- |
| 登录二维码 | `WereadService.createLoginUrl`               | `MpService.createLoginUrl`                        |
| 登录结果   | `WereadService.getLoginResult`               | `MpService.getLoginResult`                        |
| 公众号信息 | `WereadService.getMpInfo`                    | `MpService.getMpInfo`                             |
| 文章列表   | `WereadService.getMpArticles(feed.id, page)` | `MpService.getMpArticles(feed.fakerId, page - 1)` |
| 搜索公众号 | 不支持，页面使用文章链接反查                 | `MpService.searchBiz`                             |

新增平台 API：

- `platform.pipeline`：返回当前方案、名称、配置可用性和说明。
- `platform.switchPipeline`：校验目标值和任务状态后持久化切换。

## 账号隔离

- `WereadService.getAvailableAccount()` 只查询 `pipeline = 1`。
- `MpService.loadAccountSession()` 只查询 `pipeline = 2`。
- 账号列表、详情、编辑和删除 API 只允许访问当前方案的账号。
- 已归属某方案的账号 ID 禁止通过新增接口改绑到另一方案。
- 登录成功后的账号写入当前方案。
- 方案2登录流程服务端已经保存账号；前端的统一 upsert 仍保留，用于兼容方案1。

## 前端

公众号源页面增加“采集方案”卡片：

- 两个按钮分别显示“方案1 · .xyz”和“方案2 · 自有管线”。
- 当前方案突出显示。
- 点击另一方案调用切换 API，并刷新状态和缓存。
- 方案1添加订阅使用公众号文章链接；方案2使用公众号名称搜索。
- 采集状态标题显示当前方案，避免把方案2限流状态误用于方案1。

账号页面根据当前方案调整登录说明。

## 并发与失败边界

- `isRefreshAllMpArticlesRunning = true` 或历史任务正在执行时拒绝切换。
- 单个同步请求在开始时读取一次方案，不在执行中途重新读取。
- 方案2缺少 `fakerId` 时抛出 `BAD_REQUEST`。
- 上游错误继续作为错误返回，不因切换功能自动调用另一方案。
