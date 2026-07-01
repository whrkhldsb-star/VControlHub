-- TR-023: alert rule -> playbook automation links
ALTER TABLE "alert_rules"
  ADD COLUMN IF NOT EXISTS "playbookIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
