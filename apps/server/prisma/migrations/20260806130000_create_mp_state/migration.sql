-- 创建公众号采集状态表。
-- IF NOT EXISTS 兼容早期版本中由开发环境手工创建过该表的安装。
CREATE TABLE IF NOT EXISTS "mp_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trip_count" INTEGER NOT NULL DEFAULT 0,
    "trip_date" TEXT NOT NULL DEFAULT '',
    "last_sync_all_at" BIGINT NOT NULL DEFAULT 0,
    "rate_limit_started_at" BIGINT NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
