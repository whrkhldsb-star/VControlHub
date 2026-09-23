-- Session-revocation epoch + FK indexes for hot delete paths.
--
-- 1. User.sessionEpoch: embedded in session tokens at mint time and
--    re-checked on every verification (src/lib/auth/session.ts). Advanced by
--    security-relevant account events (2FA enable/disable, "sign out
--    everywhere") so previously issued cookies stop working immediately.
--    Default 0 keeps pre-epoch tokens valid across the upgrade.
-- 2. PostgreSQL does not auto-index FK columns: each new index covers a
--    CASCADE/SET NULL path that would otherwise full-scan the referencing
--    table on every parent delete.
-- 3. media_items.storageNodeId: the schema declares RESTRICT but migration
--    20260509020000 installed CASCADE — deleting a StorageNode silently
--    deleted all of a tenant's media rows. Re-align the database with the
--    schema (RESTRICT) before any data loss occurs.
-- 4. vps_backup_records/schedules: the schema declares status/runCount/
--    createdAt as required, but the original CREATE TABLE left them
--    nullable. Backfill then tighten so migrate-deploy databases match the
--    db-push databases CI tests against.
--
-- Everything is guarded so partially-migrated databases converge instead of
-- erroring (the convention used by 20260526143000_align_fresh_install_schema).

-- 1. Session epoch
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionEpoch" INTEGER NOT NULL DEFAULT 0;

-- 2. FK indexes
CREATE INDEX IF NOT EXISTS "servers_sshKeyId_idx" ON "servers"("sshKeyId");
CREATE INDEX IF NOT EXISTS "sync_jobs_sourceServerId_idx" ON "sync_jobs"("sourceServerId");
CREATE INDEX IF NOT EXISTS "sync_jobs_targetServerId_idx" ON "sync_jobs"("targetServerId");
CREATE INDEX IF NOT EXISTS "deployment_runs_templateId_idx" ON "deployment_runs"("templateId");
CREATE INDEX IF NOT EXISTS "deployment_runs_commandRequestId_idx" ON "deployment_runs"("commandRequestId");
CREATE INDEX IF NOT EXISTS "ai_hosted_actions_messageId_idx" ON "ai_hosted_actions"("messageId");
CREATE INDEX IF NOT EXISTS "ai_hosted_actions_requesterId_idx" ON "ai_hosted_actions"("requesterId");

-- 3. media_items.storageNodeId: CASCADE (installed) -> RESTRICT (schema)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'media_items_storageNodeId_fkey'
          AND conrelid = '"media_items"'::regclass
    ) THEN
        ALTER TABLE "media_items" DROP CONSTRAINT "media_items_storageNodeId_fkey";
        ALTER TABLE "media_items"
            ADD CONSTRAINT "media_items_storageNodeId_fkey"
            FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

-- 4. vps_backup NOT NULL alignment (backfill first so the constraint cannot fail)
UPDATE "vps_backup_records" SET "status" = 'PENDING' WHERE "status" IS NULL;
UPDATE "vps_backup_records" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;
ALTER TABLE "vps_backup_records"
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "createdAt" SET NOT NULL;

UPDATE "vps_backup_schedules" SET "status" = 'ACTIVE' WHERE "status" IS NULL;
UPDATE "vps_backup_schedules" SET "runCount" = 0 WHERE "runCount" IS NULL;
UPDATE "vps_backup_schedules" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;
ALTER TABLE "vps_backup_schedules"
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "runCount" SET NOT NULL,
    ALTER COLUMN "createdAt" SET NOT NULL;

-- 5. Reconcile the remaining drift between the migration chain and
--    schema.prisma on fresh installs (the recycle-bin batch column, missing
--    secondary indexes, and FK delete-behaviour). Pure constraint/index NAME
--    renames are intentionally skipped — Prisma queries care about table and
--    column shape, not names (same convention as 20260526143000).
ALTER TABLE "file_entries" ADD COLUMN IF NOT EXISTS "deleteBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "file_entries_storageNodeId_deleteBatchId_idx"
    ON "file_entries"("storageNodeId", "deleteBatchId");
CREATE INDEX IF NOT EXISTS "deployment_runs_snapshotId_idx" ON "deployment_runs"("snapshotId");
CREATE INDEX IF NOT EXISTS "media_items_mediaType_createdAt_idx" ON "media_items"("mediaType", "createdAt");
CREATE INDEX IF NOT EXISTS "media_items_storageNodeId_idx" ON "media_items"("storageNodeId");
CREATE INDEX IF NOT EXISTS "ticket_comments_authorId_idx" ON "ticket_comments"("authorId");
CREATE INDEX IF NOT EXISTS "tickets_createdBy_idx" ON "tickets"("createdBy");
CREATE INDEX IF NOT EXISTS "tickets_assigneeId_idx" ON "tickets"("assigneeId");

-- Indexes the schema no longer declares (legacy leftovers on fresh installs).
DROP INDEX IF EXISTS "ai_providers_createdBy_idx";
DROP INDEX IF EXISTS "quick_services_slug_key";

-- Column defaults/precision the schema dropped or narrowed (idempotent).
ALTER TABLE "alert_incidents" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "app_source_apps" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "app_source_apps" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "app_source_apps" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "app_source_apps" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "app_sources" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "app_sources" ALTER COLUMN "last_sync_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "app_sources" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "app_sources" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "app_sources" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "cloud_billing_accounts" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "cost_budgets" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "deployment_rollback_runs" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "itsm_connections" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "jobs" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "knowledge_bases" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "knowledge_documents" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "quick_services" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "role_templates" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "server_file_proxies" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "teams" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vps_backup_schedules" ALTER COLUMN "paths" DROP DEFAULT;

-- 5b. FK normalization pass: several constraints were created by earlier
--     migrations without the ON UPDATE CASCADE action the schema declares.
--     Drop-and-recreate unconditionally (idempotent by IF EXISTS) so the
--     chain result matches schema.prisma exactly on this axis.
DO $$
BEGIN
    -- Legacy FK the schema no longer declares (media items intentionally
    -- survive their file-entry soft-delete rows).
    ALTER TABLE "media_items" DROP CONSTRAINT IF EXISTS "media_items_fileEntryId_fkey";

    ALTER TABLE "servers" DROP CONSTRAINT IF EXISTS "servers_teamId_fkey";
    ALTER TABLE "servers" ADD CONSTRAINT "servers_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "rdp_tickets" DROP CONSTRAINT IF EXISTS "rdp_tickets_serverId_fkey";
    ALTER TABLE "rdp_tickets" ADD CONSTRAINT "rdp_tickets_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "vps_backup_schedules" DROP CONSTRAINT IF EXISTS "vps_backup_schedules_serverId_fkey";
    ALTER TABLE "vps_backup_schedules" ADD CONSTRAINT "vps_backup_schedules_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "vps_backup_schedules" DROP CONSTRAINT IF EXISTS "vps_backup_schedules_createdById_fkey";
    ALTER TABLE "vps_backup_schedules" ADD CONSTRAINT "vps_backup_schedules_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "vps_backup_records" DROP CONSTRAINT IF EXISTS "vps_backup_records_scheduleId_fkey";
    ALTER TABLE "vps_backup_records" ADD CONSTRAINT "vps_backup_records_scheduleId_fkey"
        FOREIGN KEY ("scheduleId") REFERENCES "vps_backup_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "vps_backup_records" DROP CONSTRAINT IF EXISTS "vps_backup_records_serverId_fkey";
    ALTER TABLE "vps_backup_records" ADD CONSTRAINT "vps_backup_records_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "vps_backup_records" DROP CONSTRAINT IF EXISTS "vps_backup_records_createdBy_fkey";
    ALTER TABLE "vps_backup_records" ADD CONSTRAINT "vps_backup_records_createdBy_fkey"
        FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "deployment_runs" DROP CONSTRAINT IF EXISTS "deployment_runs_commandRequestId_fkey";
    ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_commandRequestId_fkey"
        FOREIGN KEY ("commandRequestId") REFERENCES "command_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "image_uploads" DROP CONSTRAINT IF EXISTS "image_uploads_userId_fkey";
    ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "image_uploads" DROP CONSTRAINT IF EXISTS "image_uploads_storageNodeId_fkey";
    ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_storageNodeId_fkey"
        FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "ai_hosted_actions" DROP CONSTRAINT IF EXISTS "ai_hosted_actions_conversationId_fkey";
    ALTER TABLE "ai_hosted_actions" ADD CONSTRAINT "ai_hosted_actions_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ai_hosted_actions" DROP CONSTRAINT IF EXISTS "ai_hosted_actions_messageId_fkey";
    ALTER TABLE "ai_hosted_actions" ADD CONSTRAINT "ai_hosted_actions_messageId_fkey"
        FOREIGN KEY ("messageId") REFERENCES "ai_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ai_hosted_actions" DROP CONSTRAINT IF EXISTS "ai_hosted_actions_serverId_fkey";
    ALTER TABLE "ai_hosted_actions" ADD CONSTRAINT "ai_hosted_actions_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "ai_hosted_actions" DROP CONSTRAINT IF EXISTS "ai_hosted_actions_requesterId_fkey";
    ALTER TABLE "ai_hosted_actions" ADD CONSTRAINT "ai_hosted_actions_requesterId_fkey"
        FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "ai_hosted_actions" DROP CONSTRAINT IF EXISTS "ai_hosted_actions_approverId_fkey";
    ALTER TABLE "ai_hosted_actions" ADD CONSTRAINT "ai_hosted_actions_approverId_fkey"
        FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "server_file_proxies" DROP CONSTRAINT IF EXISTS "server_file_proxies_serverId_fkey";
    ALTER TABLE "server_file_proxies" ADD CONSTRAINT "server_file_proxies_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "deployment_snapshots" DROP CONSTRAINT IF EXISTS "deployment_snapshots_sourceRunId_fkey";
    ALTER TABLE "deployment_snapshots" ADD CONSTRAINT "deployment_snapshots_sourceRunId_fkey"
        FOREIGN KEY ("sourceRunId") REFERENCES "deployment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END
$$;
