-- Customers and identity templates.
-- Platform administrators work across customers without memberships. Every
-- other account belongs to at most one customer, and its permissions come
-- from one platform-defined identity template. Replaces workspace roles
-- (owner/admin/member), access roles, per-workspace policy groups and
-- account templates.

DROP TRIGGER IF EXISTS "team_members_policy_group_guard" ON "team_members";
DROP TRIGGER IF EXISTS "role_templates_assignment_guard" ON "role_templates";
DROP FUNCTION IF EXISTS enforce_team_member_policy_group();
DROP FUNCTION IF EXISTS enforce_assigned_template_stays_policy_group();

CREATE TABLE "identity_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "permissions" TEXT[],
  "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "identity_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "identity_templates_name_idx" ON "identity_templates"("name");
ALTER TABLE "identity_templates" ADD CONSTRAINT "identity_templates_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Built-in templates; the application keeps their permissions in sync.
INSERT INTO "identity_templates" ("id", "name", "description", "permissions", "isBuiltin", "updatedAt")
SELECT v.id, v.name, v.description, v.permissions, true, CURRENT_TIMESTAMP
FROM (VALUES
  ('identity:customer_admin', '客户管理员', '管理本客户的全部资源', ARRAY['api-token:manage', 'audit:read', 'ai:chat', 'ai:manage', 'ai:action:approve', 'ai:ops:read', 'ai:ops:manage', 'ai:ops:autonomous', 'command:approve', 'command:create', 'command:execute', 'command:read', 'cost:read', 'cost:manage', 'deploy:manage', 'deploy:read', 'deploy:run', 'deploy:export', 'docker:manage', 'health:read', 'image:read', 'image:write', 'media:manage', 'notification:manage', 'playbook:manage', 'playbook:read', 'playbook:run', 'server:read', 'server:ssh', 'server:sftp:unrestricted', 'server:write', 'share:create', 'share:manage', 'share:read', 'snippet:manage', 'storage:delete', 'storage:manage-node', 'storage:read', 'storage:write', 'task:read', 'team:read', 'ticket:create', 'ticket:manage', 'ticket:read', 'user:read']::TEXT[]),
  ('identity:operator', '客户运维', '连接服务器、执行任务和维护文件', ARRAY['api-token:manage', 'audit:read', 'ai:chat', 'ai:manage', 'command:create', 'command:execute', 'command:read', 'cost:read', 'cost:manage', 'deploy:read', 'deploy:run', 'deploy:export', 'docker:manage', 'health:read', 'media:manage', 'notification:manage', 'playbook:read', 'playbook:run', 'server:read', 'server:ssh', 'server:write', 'share:create', 'share:manage', 'share:read', 'snippet:manage', 'storage:read', 'storage:write', 'task:read', 'team:read', 'ticket:create', 'ticket:manage', 'ticket:read', 'user:read']::TEXT[]),
  ('identity:viewer', '客户只读', '查看服务器、文件和审计信息', ARRAY['ai:chat', 'audit:read', 'command:read', 'cost:read', 'deploy:read', 'health:read', 'server:read', 'share:read', 'storage:read', 'task:read', 'team:read', 'ticket:create', 'ticket:read', 'user:read']::TEXT[]),
  ('identity:files', '仅文件', '管理本客户的存储、文件与分享', ARRAY['ai:chat', 'audit:read', 'command:read', 'health:read', 'media:manage', 'server:read', 'share:create', 'share:manage', 'share:read', 'snippet:manage', 'storage:delete', 'storage:manage-node', 'storage:read', 'storage:write', 'task:read', 'team:read', 'ticket:create', 'ticket:manage', 'ticket:read', 'user:read']::TEXT[])
) AS v(id, name, description, permissions);

-- Administrators need no membership; other accounts keep their oldest one.
DELETE FROM "team_members" tm
USING "UserRole" ur, "Role" r
WHERE ur."userId" = tm."userId" AND ur."roleId" = r."id" AND r."key" = 'admin';

DELETE FROM "team_members" tm
WHERE EXISTS (
  SELECT 1 FROM "team_members" older
  WHERE older."userId" = tm."userId"
    AND (older."joinedAt", older."teamId") < (tm."joinedAt", tm."teamId")
);

ALTER TABLE "team_members" ADD COLUMN "identityTemplateId" TEXT;
UPDATE "team_members" tm SET "identityTemplateId" = CASE
  WHEN tm."role" IN ('owner', 'admin') THEN 'identity:customer_admin'
  WHEN tm."accessRole" = 'operator' THEN 'identity:operator'
  WHEN tm."accessRole" = 'storage_manager' THEN 'identity:files'
  WHEN tm."accessRole" = 'viewer' THEN 'identity:viewer'
  WHEN EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
               WHERE ur."userId" = tm."userId" AND r."key" = 'operator') THEN 'identity:operator'
  WHEN EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
               WHERE ur."userId" = tm."userId" AND r."key" = 'storage_manager') THEN 'identity:files'
  ELSE 'identity:viewer'
END;
ALTER TABLE "team_members" ALTER COLUMN "identityTemplateId" SET NOT NULL;

ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_permissionTemplateId_fkey";
DROP INDEX IF EXISTS "team_members_permissionTemplateId_idx";
ALTER TABLE "team_members" DROP COLUMN "permissionTemplateId";
ALTER TABLE "team_members" DROP COLUMN "accessRole";
ALTER TABLE "team_members" DROP COLUMN "role";
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_identityTemplateId_fkey"
  FOREIGN KEY ("identityTemplateId") REFERENCES "identity_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "team_members_identityTemplateId_idx" ON "team_members"("identityTemplateId");
DROP INDEX IF EXISTS "team_members_userId_idx";
CREATE UNIQUE INDEX "team_members_userId_key" ON "team_members"("userId");

DROP TABLE "role_templates";

-- Deleted customers were marked by a "__deleted__" slug prefix; use a column.
ALTER TABLE "teams" ADD COLUMN "deletedAt" TIMESTAMP(3);
UPDATE "teams" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "slug" LIKE '\_\_deleted\_\_%';

-- Customers are owned by the platform, not by an account.
ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_ownerId_fkey";
DROP INDEX IF EXISTS "teams_ownerId_idx";
ALTER TABLE "teams" DROP COLUMN "ownerId";

-- A customer account always works inside its own customer.
UPDATE "User" u SET "currentTeamId" = tm."teamId"
FROM "team_members" tm WHERE tm."userId" = u."id";
UPDATE "User" u SET "currentTeamId" = NULL
WHERE NOT EXISTS (SELECT 1 FROM "team_members" tm WHERE tm."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
                  WHERE ur."userId" = u."id" AND r."key" = 'admin');

-- Creating customers and managing their accounts is platform-only now.
DELETE FROM "RolePermission" rp USING "Permission" p
WHERE rp."permissionId" = p."id" AND p."key" IN ('team:create', 'team:member:manage');
DELETE FROM "Permission" WHERE "key" IN ('team:create', 'team:member:manage');
