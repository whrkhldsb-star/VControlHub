-- FEAT-COST-CLOUD-BILLING: cloud vendor billing account + sync run tables
CREATE TABLE IF NOT EXISTS "cloud_billing_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "lastSyncImported" INTEGER NOT NULL DEFAULT 0,
    "lastSyncSkipped" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cloud_billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cloud_billing_sync_runs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "cloud_billing_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cloud_billing_accounts_provider_enabled_idx"
  ON "cloud_billing_accounts"("provider", "enabled");
CREATE INDEX IF NOT EXISTS "cloud_billing_accounts_createdById_idx"
  ON "cloud_billing_accounts"("createdById");
CREATE INDEX IF NOT EXISTS "cloud_billing_sync_runs_accountId_startedAt_idx"
  ON "cloud_billing_sync_runs"("accountId", "startedAt");
CREATE INDEX IF NOT EXISTS "cloud_billing_sync_runs_month_idx"
  ON "cloud_billing_sync_runs"("month");

DO $$ BEGIN
  ALTER TABLE "cloud_billing_accounts"
    ADD CONSTRAINT "cloud_billing_accounts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cloud_billing_sync_runs"
    ADD CONSTRAINT "cloud_billing_sync_runs_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "cloud_billing_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
