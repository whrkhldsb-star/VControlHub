-- Scope cloud billing accounts to the active team (multi-tenant).
ALTER TABLE "cloud_billing_accounts" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

CREATE INDEX IF NOT EXISTS "cloud_billing_accounts_teamId_idx" ON "cloud_billing_accounts"("teamId");

DO $$ BEGIN
  ALTER TABLE "cloud_billing_accounts"
    ADD CONSTRAINT "cloud_billing_accounts_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
