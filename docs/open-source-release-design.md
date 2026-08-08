# 开源发布设计

## 部署闭环

统一采用一个 NestJS 进程提供 `/dash` 前端、`/trpc` 管理 API、`/feeds` RSS 与 `/img` 静态资源。SQLite 数据库和图片位于持久化 `data/` 目录；启动脚本先迁移再启动。

## 采集管线隔离

- `MpState.activePipeline` 保存当前方案。
- `Account.pipeline` 保存账号归属，服务层查询必须同时限定方案。
- 方案1只调用 `WereadService` 和 `.xyz` 平台；方案2只调用 `MpService` 和微信公众平台后台。
- 账号添加、编辑、查询、删除均按当前方案约束；同一账号标识不能跨方案改绑。
- 管线切换只改变后续任务，运行中的全量或历史同步期间拒绝切换。

## 安全边界

- 生产启动校验 `AUTH_CODE` 与 `ENCRYPTION_KEY`，拒绝空值和示例弱值。
- token 在进入数据库前加密，账号 API 仅返回安全字段。
- 管理 API 按来源 IP 做失败窗口限制；响应不携带服务端堆栈。
- 文章、头像和图片下载仅允许 HTTPS 微信域名，并限制重定向和响应体大小。
- HTTP 响应增加基础安全头，生产 CORS 只允许 `SERVER_ORIGIN_URL`。

## 验证策略

按单元测试、静态检查、前后端构建、空数据库迁移、真实进程健康检查、Docker 镜像构建、敏感信息/依赖审计的顺序执行。结果记录在 `docs/open-source-release-testing.md`。
