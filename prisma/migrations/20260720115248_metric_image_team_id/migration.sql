-- AlterTable
ALTER TABLE "metric_snapshots" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

-- AlterTable
ALTER TABLE "image_uploads" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "metric_snapshots_teamId_createdAt_idx" ON "metric_snapshots"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "image_uploads_teamId_createdAt_idx" ON "image_uploads"("teamId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill metric teamId from servers
UPDATE "metric_snapshots" ms
SET "teamId" = s."teamId"
FROM "servers" s
WHERE ms."serverId" = s.id AND ms."teamId" IS NULL AND s."teamId" IS NOT NULL;

-- Backfill image teamId from user's currentTeamId, else first membership
UPDATE "image_uploads" iu
SET "teamId" = u."currentTeamId"
FROM "User" u
WHERE iu."userId" = u.id
  AND iu."teamId" IS NULL
  AND u."currentTeamId" IS NOT NULL;

UPDATE "image_uploads" iu
SET "teamId" = tm."teamId"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "teamId"
  FROM "team_members"
  ORDER BY "userId", "joinedAt" ASC
) tm
WHERE iu."userId" = tm."userId"
  AND iu."teamId" IS NULL;
