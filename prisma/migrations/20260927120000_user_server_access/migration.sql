CREATE TABLE "user_server_access" (
  "userId" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "canRead" BOOLEAN NOT NULL DEFAULT false,
  "canConnect" BOOLEAN NOT NULL DEFAULT false,
  "canManage" BOOLEAN NOT NULL DEFAULT false,
  "canFileRead" BOOLEAN NOT NULL DEFAULT false,
  "canFileWrite" BOOLEAN NOT NULL DEFAULT false,
  "canFileDelete" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "user_server_access_pkey" PRIMARY KEY ("userId", "serverId"),
  CONSTRAINT "user_server_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_server_access_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "user_server_access_serverId_idx" ON "user_server_access"("serverId");

ALTER TABLE "role_templates" ADD COLUMN "teamId" TEXT;
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "role_templates_teamId_name_idx" ON "role_templates"("teamId", "name");
-- A single live workspace has no ambiguous owner for legacy templates.
-- Multi-workspace installations keep old unscoped templates quarantined.
WITH sole_team AS (
  SELECT id FROM "teams" WHERE LEFT(slug, 11) <> '__deleted__' LIMIT 2
)
UPDATE "role_templates"
SET "teamId" = (SELECT id FROM sole_team)
WHERE "teamId" IS NULL AND "isBuiltin" = false
  AND (SELECT count(*) FROM sole_team) = 1;

ALTER TABLE "team_members" ADD COLUMN "permissionTemplateId" TEXT;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_permissionTemplateId_fkey" FOREIGN KEY ("permissionTemplateId") REFERENCES "role_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "team_members_permissionTemplateId_idx" ON "team_members"("permissionTemplateId");
