-- 采集管线切换：账号归属 + 全局当前方案
ALTER TABLE "accounts" ADD COLUMN "pipeline" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "mp_state" ADD COLUMN "active_pipeline" INTEGER NOT NULL DEFAULT 1;

-- 兼容切换功能上线前已经混存在 Account 表中的两类明文 token：
-- 公众号后台凭据是 cookie 串（含分号/token=），应归入方案2；
-- 微信读书 Bearer token 保持默认方案1。
UPDATE "accounts"
SET "pipeline" = 2
WHERE instr("token", ';') > 0 OR instr("token", 'token=') > 0;
