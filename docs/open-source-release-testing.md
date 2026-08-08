# 开源发布测试与审计记录

日期：2026-08-08

## 结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 后端单元测试 | PASS | 10 suites / 59 tests |
| 前端静态检查 | PASS | ESLint 0 error / 0 warning |
| 前后端生产构建 | PASS | Nest build + TypeScript/Vite build |
| 全新数据库迁移 | PASS | 空 SQLite 成功应用 10 条迁移 |
| 真实生产进程 | PASS | `/dash` 200；tRPC 未授权 401、授权 200 |
| Docker 镜像 | PASS | Node 22 Alpine 镜像构建成功 |
| Docker 首次启动 | PASS | 空数据卷迁移成功；页面和管线 API 200 |
| 生产依赖审计 | PASS | `pnpm audit --prod`：0 known vulnerabilities |
| 隐藏交互扫描 | PASS | 删除 Navbar 品牌区 Tooltip；保留主题开关所需无障碍 input |
| 敏感信息扫描 | PASS | 未跟踪真实 `.env`/数据库；示例无默认密码或密钥 |

## 修复摘要

- 修复全新部署缺少 `mp_state` 建表迁移。
- 修复 Docker 包名过滤、pnpm v10 deploy、OpenSSL/Prisma、Node 版本和 1.5 GB 构建上下文问题。
- 升级 Nest、Express、React Router 等存在漏洞的生产依赖，替换并最终移除无补丁的 HTML 压缩器。
- 修复 Nest 11 下 `/dash*` 和 Feed 正则路由导致的启动失败。
- 修复数值环境变量被解析为 `NaN`、数据库类型误报 MySQL、方案2无账号却显示就绪。
- 修复账号 token 明文写入/API 返回、服务日志输出整篇正文、微信抓取 SSRF/目录穿越风险。
- 删除 Topbar 品牌区无意义的版本悬停热区及对应死代码。

## 已知非阻断提示

Vite 会报告 `next-themes` 的上游 PURE 注释和现有手工分包循环提示；构建产物可正常加载，Docker 与真实进程验收均通过。这些是构建优化提示，不是运行错误或已知漏洞。
