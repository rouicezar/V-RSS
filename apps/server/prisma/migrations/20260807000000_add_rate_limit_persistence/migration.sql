-- RedefineTables
-- 新增限流持久化字段：熔断到期时间、日请求计数、上次请求时间戳
-- SQLite 不支持 ALTER COLUMN DEFAULT，但 Prisma 通过重建表处理
ALTER TABLE "mp_state" ADD COLUMN "rate_limited_until" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "mp_state" ADD COLUMN "daily_req_date" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mp_state" ADD COLUMN "daily_req_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "mp_state" ADD COLUMN "last_article_req" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "mp_state" ADD COLUMN "last_search_req" BIGINT NOT NULL DEFAULT 0;
