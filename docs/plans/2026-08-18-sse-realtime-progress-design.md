# SSE 实时采集/打标进度推送设计

日期：2026-08-18
状态：已确认，实现中

## 背景

当前采集（`feed.refreshArticles` / `feed.getHistoryArticles`）与批量 AI 打标（`tag.extractAll`）均为一次性 mutation：后端逐篇入库/打标完成后，前端才 refetch 列表。用户在任务运行期间只能看到"更新中"按钮和 10s 轮询的页码，看不到已扫描到的文章，体验割裂。

目标：任务运行期间，已扫描入库的文章、已完成的打标结果**实时**出现在界面上，无需等待完成或手动刷新。

## 方案：SSE（Server-Sent Events）单向推送

服务端 → 客户端单向事件流，符合"进度展示"场景；零新依赖（rxjs 已是项目依赖，NestJS 原生支持流式响应）。

### 事件协议

`{ type, data }`，JSON 编码，`data:` 行输出：

| type | data | 触发点 |
|------|------|--------|
| `article:upserted` | 完整 article 行（id/mpId/title/digest/picUrl/publishTime/url/status…） | `refreshMpArticlesAndUpdateFeed` 事务入库后逐篇 emit |
| `article:tagged` | `{ articleId, tags: string[], domain }` | `tagAllArticlesWithAI` 每篇打标完成 |
| `job:started` | `{ job: 'refreshAll' \| 'history' \| 'tagAll', mpId?, total }` | 三个任务入口 |
| `job:progress` | `{ job, mpId?, current, total, detail? }` | 每处理一个源/一页/一篇 |
| `job:finished` | `{ job, mpId?, result? }` | 任务 finally 块 |

## 后端结构

```
apps/server/src/events/
  events.service.ts     // @Injectable，rxjs Subject 总线：emit()/subscribe()
  events.controller.ts  // GET /events：SSE 输出、?token= 鉴权、30s 心跳、断连清理
  events.module.ts      // @Global()，导出 EventsService
```

- `EventsModule` 加入 `AppModule.imports`，`@Global()` 使 `EventsService` 可注入 `TrpcService`、`AnalysisService`。
- 鉴权：`?token=<AUTH_CODE>`（EventSource 无法带自定义 header）；与 `/trpc` 的 Authorization 校验同一密码源。token 出现在 URL 属本地自托管可接受范围。
- 心跳：每 30s 写 `: ping` 注释行，防止代理/浏览器断连。
- 清理：`req.on('close')` 时清除心跳定时器并 unsubscribe。

### 埋点

- `trpc.service.ts`
  - `refreshMpArticlesAndUpdateFeed`：`$transaction` 返回的 results（完整行）逐篇 emit `article:upserted`。
  - `refreshAllMpArticlesAndUpdateFeed`：`job:started(total=mps.length)` → 每源 `job:progress` → finally `job:finished`。
  - `getHistoryMpArticles`：`job:started(mpId)` → 每页 `job:progress` → finally `job:finished`。
- `analysis.service.ts` `tagAllArticlesWithAI`：`job:started(total)` → 每篇 `article:tagged` + `job:progress(detail=title)` → `job:finished(result={total,done})`。

## 前端结构

```
apps/web/src/hooks/useProgressEvents.ts  // 模块级单例 EventSource + 事件分发
apps/web/src/components/ProgressEventsBridge.tsx  // 空组件，挂载即建立连接
```

- 连接：`/events?token=${getAuthCode()}`，EventSource 原生自动重连；token 变化（重新登录）时重建连接。
- 事件 → react-query 缓存就地更新（列表组件零改动自动重渲染）：
  - `article:upserted`：`setQueriesData` 遍历所有 `article.list` 缓存，匹配 `mpId` 筛选则按 publishTime 降序插入并去重；同时失效 `feed.list`（syncTime 变化）。
  - `article:tagged`：就地更新缓存中该文章 tags 字段；失效 `tag.list`。
  - `job:*`：更新全局进度状态（context）；`job:finished` 兜底失效 `article.list` / `feed.list` / `tag.list` 保证最终一致。
- 进度 UI：
  - `feeds/index.tsx`：任务运行时按钮旁显示"更新全部 2/7"等。
  - `library/Library.tsx`：AI 批量打标按钮显示"打标中 3/50 · 标题…"。

## 验证

1. 单测：EventsService emit → subscribe 收到事件；subscribe 返回的取消函数生效。
2. 手动：`curl -N "http://localhost:4000/events?token=…"` 触发 `refreshArticles`，观察事件流输出。
3. 页面：触发"立即更新"/"更新全部"/"AI 批量打标"，确认列表实时增长、进度文本更新、任务结束一致。

## 风险与权衡

- token 出现在 SSE URL：本地自托管可接受；不做额外加密。
- 单连接事件流按进程内广播：个人使用 1~2 个前端连接，无压力。
- `article:upserted` 载荷为完整文章行（含正文外字段），单篇 <10KB，可忽略。
