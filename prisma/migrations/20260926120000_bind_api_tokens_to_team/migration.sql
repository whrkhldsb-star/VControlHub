-- A token's tenant is immutable. Existing bearer tokens were implicitly bound
-- to their owner's mutable currentTeamId, so their original scope cannot be
-- reconstructed safely. Revoke them during migration instead of guessing.
ALTER TABLE "api_tokens" ADD COLUMN "teamId" TEXT;
UPDATE "api_tokens" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL;

ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_active_team_check"
  CHECK ("teamId" IS NOT NULL OR "revokedAt" IS NOT NULL);

ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "api_tokens_teamId_revokedAt_idx" ON "api_tokens"("teamId", "revokedAt");
