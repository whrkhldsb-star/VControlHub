-- Team scope for alert rules and cost entries/budgets (design debt payoff)
-- teamId NULL remains readable as shared/legacy (teamWhere OR null).

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

ALTER TABLE "cost_budgets" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
CREATE INDEX IF NOT EXISTS "cost_budgets_teamId_idx" ON "cost_budgets"("teamId");
DO $$ BEGIN
  ALTER TABLE "cost_budgets"
    ADD CONSTRAINT "cost_budgets_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
