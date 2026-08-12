# Issue #1 知识库迁移修复设计

## 方案

新增一个时间顺序位于现有迁移之后的补偿迁移，创建 `knowledge_base` 表。这样空数据库会在完整迁移链末尾得到正确结构，已部署数据库也会在下次 `prisma migrate deploy` 时应用补丁。

## 表结构映射

| Prisma 字段 | SQLite 列 | 约束 |
| --- | --- | --- |
| `id` | `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `title` | `title` | `TEXT NOT NULL` |
| `content` | `content` | `TEXT NOT NULL` |
| `articleCount` | `article_count` | `INTEGER NOT NULL DEFAULT 0` |
| `imageCount` | `image_count` | `INTEGER NOT NULL DEFAULT 0` |
| `createdAt` | `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |

## 兼容性

- 保留旧迁移原文，避免改变已发布迁移的 checksum。
- 新迁移只补齐缺失表，不涉及数据搬迁。
- 当前已知发布迁移链不会创建同名表，因此使用标准 `CREATE TABLE`，让异常的结构漂移明确失败而非静默掩盖。
