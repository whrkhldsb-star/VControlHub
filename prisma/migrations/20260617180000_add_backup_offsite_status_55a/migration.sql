-- TR-009 55a: 备份 → 异地 S3 上传状态字段。
--
-- 给 backup_records 加 3 列 + 1 索引:
--   offsiteKey          TEXT          — S3 对象 key (e.g. vcontrolhub-backups/2026-06-17/xxx-database.gz)
--   offsiteUploadedAt   TIMESTAMP(3)  — 成功上传时间; null = 未上传 / 失败 / 已禁用
--   offsiteSize         TEXT          — 压缩后大小 (String, 跟 fileSize 风格一致)
--   索引 offsiteUploadedAt (做 retention sweep 用)
--
-- 字段 nullable, 不会破坏现有 row; 上传 pipeline 是 best-effort, 失败时只把
-- 原因塞进已有 errorMessage (前缀 [offsite-upload]), 不改 status。

ALTER TABLE "backup_records"
    ADD COLUMN "offsiteKey" TEXT,
    ADD COLUMN "offsiteUploadedAt" TIMESTAMP(3),
    ADD COLUMN "offsiteSize" TEXT;

CREATE INDEX "backup_records_offsiteUploadedAt_idx" ON "backup_records"("offsiteUploadedAt");
