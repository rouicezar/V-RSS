# V-RSS Server

NestJS + tRPC + Prisma/SQLite 服务端，负责采集管线、账号隔离、RSS 输出、正文缓存和可选 AI 分析。

部署、配置和排错以仓库根目录 [README](../../README.md) 为准。开发命令：

```bash
pnpm --filter vrss-server test
pnpm --filter vrss-server build
```
