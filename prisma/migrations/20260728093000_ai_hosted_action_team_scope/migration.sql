-- Scope AI hosted approvals to a team. Existing server-bound actions inherit
-- the target server team; serverless legacy rows remain null and manager-only.
ALTER TABLE "ai_hosted_actions" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

UPDATE "ai_hosted_actions" AS action
SET "teamId" = server."teamId"
FROM "servers" AS server
WHERE action."serverId" = server."id"
  AND action."teamId" IS NULL
  AND server."teamId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ai_hosted_actions_teamId_status_createdAt_idx"
  ON "ai_hosted_actions"("teamId", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ai_hosted_actions"
    ADD CONSTRAINT "ai_hosted_actions_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;