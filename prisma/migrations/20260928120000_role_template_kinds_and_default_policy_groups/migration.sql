-- Account snapshots and live workspace policy groups have different security
-- semantics. Keep the distinction in the database instead of guessing from
-- whether a template happens to contain resource grants.
ALTER TABLE "role_templates"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ACCOUNT_TEMPLATE';

ALTER TABLE "role_templates"
  ADD CONSTRAINT "role_templates_kind_check"
  CHECK ("kind" IN ('ACCOUNT_TEMPLATE', 'POLICY_GROUP'));

-- Anything already assigned to a membership is necessarily a live group.
-- Unassigned, workspace-local templates without resource snapshots were also
-- created by the permission-group UI before this discriminator existed.
UPDATE "role_templates" rt
SET "kind" = 'POLICY_GROUP'
WHERE rt."teamId" IS NOT NULL
  AND rt."isBuiltin" = FALSE
  AND (
    EXISTS (
      SELECT 1 FROM "team_members" tm
      WHERE tm."permissionTemplateId" = rt."id"
    )
    OR (
      COALESCE(jsonb_array_length(CASE
        WHEN jsonb_typeof(rt."dataScope"->'serverAccess') = 'array'
          THEN rt."dataScope"->'serverAccess' ELSE '[]'::jsonb END), 0) = 0
      AND COALESCE(jsonb_array_length(CASE
        WHEN jsonb_typeof(rt."dataScope"->'storageAccess') = 'array'
          THEN rt."dataScope"->'storageAccess' ELSE '[]'::jsonb END), 0) = 0
    )
  );

-- Canonicalize live groups to one exact permission list. Role bundles remain a
-- UI shortcut, but must not silently re-grant a checkbox an administrator
-- removed from a group.
UPDATE "role_templates" rt
SET
  "permissions" = ARRAY(
    SELECT DISTINCT combined.permission_key
    FROM (
      SELECT unnest(rt."permissions") AS permission_key
      UNION ALL
      SELECT p."key"
      FROM unnest(rt."roleKeys") AS roles(role_key)
      JOIN "Role" r ON r."key" = roles.role_key
      JOIN "RolePermission" rp ON rp."roleId" = r."id"
      JOIN "Permission" p ON p."id" = rp."permissionId"
    ) combined
    WHERE combined.permission_key NOT IN (
      'announcement:manage', 'api-token:manage',
      'backup:create', 'backup:read', 'backup:restore',
      'role:manage', 'team:create', 'team:manage', 'team:member:manage',
      'user:manage'
    )
    ORDER BY combined.permission_key
  ),
  "roleKeys" = ARRAY[]::TEXT[]
WHERE rt."kind" = 'POLICY_GROUP';

DROP INDEX IF EXISTS "role_templates_teamId_name_idx";
CREATE INDEX "role_templates_teamId_kind_name_idx"
  ON "role_templates"("teamId", "kind", "name");

-- Owner/admin access is role-based. Remove member ceilings and hidden resource
-- rows so a future demotion does not unexpectedly revive stale restrictions.
UPDATE "team_members"
SET "accessRole" = 'inherit', "permissionTemplateId" = NULL
WHERE "role" IN ('owner', 'admin');

DELETE FROM "user_server_access" usa
USING "servers" s, "team_members" tm
WHERE usa."serverId" = s."id"
  AND tm."teamId" = s."teamId"
  AND tm."userId" = usa."userId"
  AND tm."role" IN ('owner', 'admin');

DELETE FROM "user_storage_access" usa
USING "StorageNode" n, "team_members" tm
WHERE usa."storageNodeId" = n."id"
  AND tm."teamId" = n."teamId"
  AND tm."userId" = usa."userId"
  AND tm."role" IN ('owner', 'admin');

-- Preserve the same invariant for every future write path, including scripts
-- and imports that do not call the application service.
CREATE OR REPLACE FUNCTION enforce_team_member_policy_group()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."role" IN ('owner', 'admin') THEN
    IF NEW."accessRole" <> 'inherit' OR NEW."permissionTemplateId" IS NOT NULL THEN
      RAISE EXCEPTION 'workspace administrators cannot carry member permission ceilings';
    END IF;
  ELSIF NEW."permissionTemplateId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "role_templates" rt
    WHERE rt."id" = NEW."permissionTemplateId"
      AND rt."teamId" = NEW."teamId"
      AND rt."kind" = 'POLICY_GROUP'
      AND rt."isBuiltin" = FALSE
  ) THEN
    RAISE EXCEPTION 'membership permission group must be an editable policy group from the same workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "team_members_policy_group_guard"
BEFORE INSERT OR UPDATE OF "role", "accessRole", "permissionTemplateId", "teamId"
ON "team_members"
FOR EACH ROW EXECUTE FUNCTION enforce_team_member_policy_group();

CREATE OR REPLACE FUNCTION enforce_assigned_template_stays_policy_group()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "team_members" tm
    WHERE tm."permissionTemplateId" = OLD."id"
      AND (
        NEW."kind" <> 'POLICY_GROUP'
        OR NEW."isBuiltin" = TRUE
        OR NEW."teamId" IS DISTINCT FROM tm."teamId"
      )
  ) THEN
    RAISE EXCEPTION 'an assigned policy group cannot change kind or workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "role_templates_assignment_guard"
BEFORE UPDATE OF "kind", "isBuiltin", "teamId"
ON "role_templates"
FOR EACH ROW EXECUTE FUNCTION enforce_assigned_template_stays_policy_group();

-- Every existing live workspace receives editable starting groups. These are
-- ordinary workspace rows: administrators may rename, change, or delete them.
INSERT INTO "role_templates" (
  "id", "name", "description", "kind", "roleKeys", "permissions",
  "dataScope", "isBuiltin", "createdBy", "teamId", "createdAt", "updatedAt"
)
SELECT
  'policy:' || t."id" || ':' || defaults.key,
  defaults.name,
  defaults.description,
  'POLICY_GROUP',
  ARRAY[]::TEXT[],
  ARRAY(
    SELECT p."key"
    FROM "Role" r
    JOIN "RolePermission" rp ON rp."roleId" = r."id"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE r."key" = defaults.role_key
      AND p."key" NOT IN (
        'announcement:manage', 'api-token:manage',
        'backup:create', 'backup:read', 'backup:restore',
        'role:manage', 'team:create', 'team:manage', 'team:member:manage',
        'user:manage'
      )
    ORDER BY p."key"
  )::TEXT[],
  '{"storageAccess":[],"serverAccess":[]}'::jsonb,
  FALSE,
  t."ownerId",
  t."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "teams" t
CROSS JOIN (VALUES
  ('viewer', '只读观察员', '查看服务器、云盘和审计信息', 'viewer'),
  ('operator', '日常运维', '服务器连接、执行任务和文件维护', 'operator'),
  ('storage_manager', '云盘管理员', '管理云盘节点、文件与分享', 'storage_manager')
) AS defaults(key, name, description, role_key)
WHERE LEFT(t."slug", 11) <> '__deleted__'
  AND NOT EXISTS (
    SELECT 1 FROM "role_templates" existing
    WHERE existing."teamId" = t."id"
      AND existing."kind" = 'POLICY_GROUP'
      AND existing."name" = defaults.name
  )
ON CONFLICT ("id") DO NOTHING;
