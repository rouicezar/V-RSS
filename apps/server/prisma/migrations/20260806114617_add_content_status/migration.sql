-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_articles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mp_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pic_url" TEXT NOT NULL,
    "publish_time" INTEGER NOT NULL,
    "url" TEXT,
    "digest" TEXT,
    "content" TEXT,
    "content_text" TEXT,
    "content_status" INTEGER NOT NULL DEFAULT 0,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "favorite_time" DATETIME,
    "ai_summary" TEXT,
    "domain" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_articles" ("ai_summary", "content", "content_text", "created_at", "digest", "domain", "favorite_time", "id", "is_favorite", "mp_id", "pic_url", "publish_time", "status", "title", "updated_at", "url") SELECT "ai_summary", "content", "content_text", "created_at", "digest", "domain", "favorite_time", "id", "is_favorite", "mp_id", "pic_url", "publish_time", "status", "title", "updated_at", "url" FROM "articles";
DROP TABLE "articles";
ALTER TABLE "new_articles" RENAME TO "articles";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
