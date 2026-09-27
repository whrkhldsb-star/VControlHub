-- Recover unassigned legacy resources only when ownership is unambiguous.
-- With multiple live workspaces, NULL rows stay quarantined for manual review.
DO $$
DECLARE
  live_count INTEGER;
  target_team TEXT;
  owner_user TEXT;
  target_table TEXT;
BEGIN
  SELECT COUNT(*) INTO live_count FROM "teams"
  WHERE LEFT("slug", 11) <> '__deleted__';

  IF live_count = 0 THEN
    SELECT u."id" INTO owner_user
    FROM "User" u
    LEFT JOIN "UserRole" ur ON ur."userId" = u."id"
    LEFT JOIN "Role" r ON r."id" = ur."roleId" AND r."key" = 'admin'
    ORDER BY (r."id" IS NOT NULL) DESC, u."createdAt" ASC
    LIMIT 1;

    IF owner_user IS NOT NULL THEN
      target_team := 'legacy_default_workspace';
      INSERT INTO "teams" ("id", "slug", "name", "ownerId", "createdAt", "updatedAt")
      VALUES (target_team, 'default', 'Default workspace', owner_user, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "team_members" ("teamId", "userId", "role", "joinedAt")
      SELECT target_team, u."id", CASE WHEN u."id" = owner_user THEN 'owner' ELSE 'member' END, CURRENT_TIMESTAMP
      FROM "User" u;
      UPDATE "User" SET "currentTeamId" = target_team WHERE "currentTeamId" IS NULL;
    END IF;
  ELSIF live_count = 1 AND (SELECT COUNT(*) FROM "teams") = 1 THEN
    SELECT "id" INTO target_team FROM "teams"
    WHERE LEFT("slug", 11) <> '__deleted__' LIMIT 1;
  END IF;

  IF target_team IS NOT NULL THEN
    FOREACH target_table IN ARRAY ARRAY[
      'SshKey', 'servers', 'rdp_tickets', 'command_requests', 'StorageNode',
      'audit_logs', 'jobs', 'scheduled_tasks', 'playbooks', 'playbook_runs',
      'metric_snapshots', 'alert_rules', 'notifications', 'sync_jobs',
      'download_tasks', 'share_links', 'backup_records', 'backup_schedules',
      'deployment_runs', 'tickets', 'image_uploads', 'ai_hosted_actions',
      'cost_entries', 'cost_budgets', 'cloud_billing_accounts',
      'knowledge_bases', 'itsm_connections'
    ] LOOP
      EXECUTE format('UPDATE %I SET "teamId" = $1 WHERE "teamId" IS NULL', target_table)
      USING target_team;
    END LOOP;
    -- Built-in templates remain explicitly public. User-created templates do not.
    UPDATE "command_templates" SET "teamId" = target_team
    WHERE "teamId" IS NULL AND "isBuiltin" = FALSE;
  END IF;
END $$;
