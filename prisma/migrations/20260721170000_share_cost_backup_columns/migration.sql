-- Columns present in Prisma schema/product code but missing on fresh migrate history.

ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "maxDownloads" INTEGER;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "permissionLevel" TEXT NOT NULL DEFAULT 'download';

ALTER TABLE "cost_entries" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "backup_records" ADD COLUMN IF NOT EXISTS "checksumSha256" TEXT;
