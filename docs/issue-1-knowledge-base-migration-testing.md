# Issue #1 知识库迁移修复测试记录

日期：2026-08-12

## 自动化验证

- `prisma validate`：通过，schema 有效。
- 空 SQLite 数据库执行 `prisma migrate deploy`：通过，11 条迁移全部成功应用。
- `prisma migrate status`：通过，数据库结构为最新状态。
- 后端完整测试：10 个测试套件、59 个测试全部通过。
- 后端 Nest 生产构建：通过。
- `git diff --check`：通过，无空白错误。

## 数据库结构验证

在空库完整迁移后直接查询 SQLite：

- `knowledge_base` 表存在。
- 字段为 `id`、`title`、`content`、`article_count`、`image_count`、`created_at`。
- `id` 是自增整数主键。
- `article_count` 和 `image_count` 默认值均为 `0`。
- `created_at` 默认值为 `CURRENT_TIMESTAMP`。

## 首轮诊断说明

- 首次临时库迁移返回 Prisma `Schema engine error: undefined`，且未创建数据库文件；使用新的临时文件并启用诊断环境后完整迁移成功，未复现。
- 首次 Jest 命令多传一层 `--`，使 `--runInBand` 被当作测试匹配条件；修正命令后 59 项测试全部通过。

## 验收结论

Issue #1 描述的空库缺表问题已通过补偿迁移修复。验证覆盖完整迁移链、真实 SQLite 表结构、业务测试和生产构建。
