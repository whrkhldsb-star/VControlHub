-- VPS backup timing: startedAt (RUNNING claim) + durationMs (startedAt→completedAt).
-- Both nullable/additive: no table rewrite, no backfill, safe on a live table.
ALTER TABLE "vps_backup_records"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "durationMs" INTEGER;
