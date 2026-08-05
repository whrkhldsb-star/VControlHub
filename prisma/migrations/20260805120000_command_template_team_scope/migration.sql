-- Keep built-in templates shared, while assigning existing custom templates
-- to the creator's current workspace before enforcing service-level filters.
ALTER TABLE "command_templates" ADD COLUMN "teamId" TEXT;

UPDATE "command_templates" AS ct
SET "teamId" = u."currentTeamId"
FROM "User" AS u
WHERE ct."isBuiltin" = false
  AND ct."createdById" = u."id"
  AND u."currentTeamId" IS NOT NULL;

CREATE INDEX "command_templates_teamId_isBuiltin_name_idx"
  ON "command_templates" ("teamId", "isBuiltin", "name");

ALTER TABLE "command_templates"
  ADD CONSTRAINT "command_templates_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
