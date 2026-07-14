-- SSH host key pinning for managed servers and SFTP storage nodes.
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "hostKeySha256" TEXT;
DO $$
BEGIN
  -- 20260703090000 temporarily renamed this table to storage_nodes. Later
  -- installations may already use the production-compatible StorageNode name.
  IF to_regclass('public."StorageNode"') IS NOT NULL THEN
    ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "hostKeySha256" TEXT;
  ELSIF to_regclass('public.storage_nodes') IS NOT NULL THEN
    ALTER TABLE storage_nodes ADD COLUMN IF NOT EXISTS "hostKeySha256" TEXT;
  END IF;
END $$;

-- Dashboard analytics global time-range indexes.
CREATE INDEX IF NOT EXISTS "metric_snapshots_createdAt_idx" ON "metric_snapshots" ("createdAt");
CREATE INDEX IF NOT EXISTS "download_tasks_createdAt_idx" ON "download_tasks" ("createdAt");
CREATE INDEX IF NOT EXISTS "image_uploads_createdAt_idx" ON "image_uploads" ("createdAt");
