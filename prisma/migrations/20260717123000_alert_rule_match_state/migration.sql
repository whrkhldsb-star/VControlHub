-- Per-server sustained-match state for multi-host durationSeconds evaluation.
ALTER TABLE "alert_rules" ADD COLUMN IF NOT EXISTS "matchState" JSONB;

-- Seed matchState from legacy lastMatchedAt for rules that already have a pending duration.
UPDATE "alert_rules"
SET "matchState" = jsonb_build_object('_legacy', to_char("lastMatchedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE "lastMatchedAt" IS NOT NULL
  AND ("matchState" IS NULL OR "matchState" = 'null'::jsonb);
