-- Team scope for alert rules and cost entries/budgets (design debt payoff)
-- teamId NULL remains readable as shared/legacy (teamWhere OR null).
--
-- Fresh installs never created cost_budgets in 20260617150000_add_cost_tracking_e01
-- (only cost_entries + cost_snapshots). Ensure the table exists before ALTERing it.

ALTER TABLE "alert_rules" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
CREATE INDEX IF NOT EXISTS "alert_rules_teamId_idx" ON "alert_rules"("teamId");
DO $$ BEGIN
  ALTER TABLE "alert_rules"
    ADD CONSTRAINT "alert_rules_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "cost_entries" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
CREATE INDEX IF NOT EXISTS "cost_entries_teamId_idx" ON "cost_entries"("teamId");
DO $$ BEGIN
  ALTER TABLE "cost_entries"
    ADD CONSTRAINT "cost_entries_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "cost_budgets" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limitAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "alertThresholdPercent" DOUBLE PRECISION NOT NULL DEFAULT 80,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_budgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cost_budgets_category_period_idx" ON "cost_budgets"("category", "period");

ALTER TABLE "cost_budgets" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
CREATE INDEX IF NOT EXISTS "cost_budgets_teamId_idx" ON "cost_budgets"("teamId");
DO $$ BEGIN
  ALTER TABLE "cost_budgets"
    ADD CONSTRAINT "cost_budgets_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
