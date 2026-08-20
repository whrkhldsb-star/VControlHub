-- Materialize Cron trigger state and retain per-server metric-edge state so
-- Playbook automation can be scheduled safely without replaying every past
-- occurrence after a worker restart.
ALTER TABLE "playbooks"
  ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastTriggeredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metricMatchState" JSONB;

-- A trigger occurrence must enqueue at most one durable PlaybookRun. The
-- nullable key leaves existing/manual rows unaffected (PostgreSQL allows
-- multiple null values in a unique index).
ALTER TABLE "playbook_runs"
  ADD COLUMN IF NOT EXISTS "triggerKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "playbook_runs_playbookId_triggerKey_key"
  ON "playbook_runs"("playbookId", "triggerKey");

CREATE INDEX IF NOT EXISTS "playbooks_enabled_triggerType_nextRunAt_idx"
  ON "playbooks"("enabled", "triggerType", "nextRunAt");
