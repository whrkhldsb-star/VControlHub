-- Persist the FEAT-P0-1 team-scope schema that was initially applied with
-- `prisma db push`.  The statements are idempotent so databases that already
-- received that push and clean installations both converge safely.

-- 20260703090000 renamed legacy production tables, while the application was
-- subsequently restored to their established PascalCase names. Normalize a
-- clean migration replay to the same names without touching existing systems.
DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['users', 'User'],
    ['roles', 'Role'],
    ['permissions', 'Permission'],
    ['user_roles', 'UserRole'],
    ['role_permissions', 'RolePermission'],
    ['ssh_keys', 'SshKey'],
    ['storage_nodes', 'StorageNode']
  ] LOOP
    IF to_regclass(format('public.%I', pair[1])) IS NOT NULL
       AND to_regclass(format('public.%I', pair[2])) IS NULL THEN
      EXECUTE format('ALTER TABLE %I RENAME TO %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
  scoped_tables text[] := ARRAY[
    'command_requests', 'StorageNode', 'audit_logs', 'jobs',
    'scheduled_tasks', 'playbooks', 'playbook_runs', 'notifications',
    'sync_jobs', 'download_tasks', 'share_links', 'backup_records',
    'deployment_runs', 'tickets'
  ];
BEGIN
  FOREACH table_name IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "teamId" TEXT', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("teamId")', table_name || '_teamId_idx', table_name);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = table_name || '_teamId_fkey'
        AND conrelid = to_regclass(format('%I', table_name))
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("teamId") REFERENCES teams(id) ON DELETE SET NULL ON UPDATE CASCADE',
        table_name,
        table_name || '_teamId_fkey'
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS "relatedServerId" TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS "relatedCommandId" TEXT;
CREATE INDEX IF NOT EXISTS "tickets_relatedServerId_idx" ON tickets ("relatedServerId");
CREATE INDEX IF NOT EXISTS "tickets_relatedCommandId_idx" ON tickets ("relatedCommandId");
