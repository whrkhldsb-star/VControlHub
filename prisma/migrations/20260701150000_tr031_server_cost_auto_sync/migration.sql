-- TR-031: server monthly cost auto-sync source fields
ALTER TABLE "servers"
  ADD COLUMN IF NOT EXISTS "costAutoSync" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "costMonthlyAmount" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "costCurrency" TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS "costProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "costLastSyncedAt" TIMESTAMP(3);

ALTER TABLE "cost_entries"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;

CREATE INDEX IF NOT EXISTS "cost_entries_sourceType_sourceRef_effectiveDate_idx"
  ON "cost_entries"("sourceType", "sourceRef", "effectiveDate");

CREATE UNIQUE INDEX IF NOT EXISTS "cost_entries_sourceType_sourceRef_effectiveDate_key"
  ON "cost_entries"("sourceType", "sourceRef", "effectiveDate");
