-- SSH host key pinning for managed servers and SFTP storage nodes.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "hostKeySha256" TEXT;
ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "hostKeySha256" TEXT;

-- Dashboard analytics global time-range indexes.
CREATE INDEX IF NOT EXISTS "metric_snapshots_createdAt_idx" ON "metric_snapshots" ("createdAt");
CREATE INDEX IF NOT EXISTS "download_tasks_createdAt_idx" ON "download_tasks" ("createdAt");
CREATE INDEX IF NOT EXISTS "image_uploads_createdAt_idx" ON "image_uploads" ("createdAt");
