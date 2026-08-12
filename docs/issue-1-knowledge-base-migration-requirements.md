# Issue #1 知识库迁移修复需求

## 问题

全新 SQLite 数据库执行完整 Prisma 迁移链后，`knowledge_base` 表不存在，但 Prisma schema 和运行时代码会查询该表，导致知识库功能报错。

## 目标

- 新部署执行迁移后必须创建与 `KnowledgeBase` 模型一致的 `knowledge_base` 表。
- 已经应用历史迁移的部署必须能安全补齐该表。
- 不修改已经发布的历史迁移，避免迁移校验和部署状态不一致。

## 验收标准

- 空 SQLite 数据库可成功执行完整迁移链。
- 迁移后存在 `knowledge_base` 表及 `id`、`title`、`content`、`article_count`、`image_count`、`created_at` 字段。
- 默认值和主键行为与 `schema.prisma` 中的 `KnowledgeBase` 模型一致。
- Prisma schema 校验、后端测试和后端构建通过。

## 非目标

- 不改变知识库业务逻辑或页面。
- 不重写 `20260806110002_add_knowledge_base` 历史迁移。
