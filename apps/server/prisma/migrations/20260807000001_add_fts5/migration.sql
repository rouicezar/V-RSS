-- 创建文章标题与正文的全文搜索索引（SQLite FTS5）
-- FTS5 虚拟表不支持 Prisma schema，通过原始 SQL 创建
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  content_text,
  content='articles',
  content_rowid='rowid'
);

-- 触发器：插入时同步到 FTS
CREATE TRIGGER IF NOT EXISTS articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, content_text)
  VALUES (new.rowid, new.title, new.content_text);
END;

-- 触发器：更新时同步到 FTS
CREATE TRIGGER IF NOT EXISTS articles_fts_update AFTER UPDATE ON articles BEGIN
  UPDATE articles_fts SET
    title = new.title,
    content_text = new.content_text
  WHERE rowid = old.rowid;
END;

-- 触发器：删除时同步 FTS
CREATE TRIGGER IF NOT EXISTS articles_fts_delete AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, content_text)
  VALUES ('delete', old.rowid, old.title, old.content_text);
END;

-- 填充已有数据
INSERT INTO articles_fts(rowid, title, content_text)
SELECT rowid, title, content_text FROM articles WHERE status = 1;
