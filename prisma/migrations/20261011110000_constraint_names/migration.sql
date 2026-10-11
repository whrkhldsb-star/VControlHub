-- Align constraint and index names with what Prisma derives from the schema.
-- Early migrations created these before tables were renamed (@@map), so
-- `prisma migrate diff` kept reporting renames and every generated migration
-- would carry them. Only renames: no table, column or data changes. Each
-- rename runs only when the old name exists and the new one does not, so a
-- database that already uses the new names is left alone.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Permission', 'permissions_pkey', 'Permission_pkey'),
    ('Role', 'roles_pkey', 'Role_pkey'),
    ('RolePermission', 'role_permissions_pkey', 'RolePermission_pkey'),
    ('SshKey', 'ssh_keys_pkey', 'SshKey_pkey'),
    ('StorageNode', 'storage_nodes_pkey', 'StorageNode_pkey'),
    ('User', 'users_pkey', 'User_pkey'),
    ('UserRole', 'user_roles_pkey', 'UserRole_pkey'),
    ('download_tasks', 'DownloadTask_pkey', 'download_tasks_pkey'),
    ('servers', 'Server_pkey', 'servers_pkey'),
    ('app_source_apps', 'app_source_apps_sourceId_fkey', 'app_source_apps_source_id_fkey'),
    ('audit_logs', 'AuditLog_actorId_fkey', 'audit_logs_actorId_fkey'),
    ('command_approvals', 'CommandApproval_approverId_fkey', 'command_approvals_approverId_fkey'),
    ('command_approvals', 'CommandApproval_commandRequestId_fkey', 'command_approvals_commandRequestId_fkey'),
    ('command_requests', 'CommandRequest_requesterId_fkey', 'command_requests_requesterId_fkey'),
    ('command_targets', 'CommandTarget_commandRequestId_fkey', 'command_targets_commandRequestId_fkey'),
    ('command_targets', 'CommandTarget_serverId_fkey', 'command_targets_serverId_fkey'),
    ('download_tasks', 'DownloadTask_createdBy_fkey', 'download_tasks_createdBy_fkey'),
    ('download_tasks', 'DownloadTask_serverId_fkey', 'download_tasks_serverId_fkey'),
    ('execution_logs', 'ExecutionLog_commandRequestId_fkey', 'execution_logs_commandRequestId_fkey'),
    ('file_entries', 'FileEntry_parentId_fkey', 'file_entries_parentId_fkey'),
    ('file_entries', 'FileEntry_storageNodeId_fkey', 'file_entries_storageNodeId_fkey'),
    ('servers', 'Server_sshKeyId_fkey', 'servers_sshKeyId_fkey')
  ) AS v(tbl, old_name, new_name) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
               WHERE t.relname = r.tbl AND c.conname = r.old_name)
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                       WHERE t.relname = r.tbl AND c.conname = r.new_name) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('permissions_key_key', 'Permission_key_key'),
    ('roles_key_key', 'Role_key_key'),
    ('ssh_keys_fingerprint_key', 'SshKey_fingerprint_key'),
    ('storage_nodes_serverId_key', 'StorageNode_serverId_key'),
    ('users_username_key', 'User_username_key'),
    ('CommandApproval_approverId_idx', 'command_approvals_approverId_idx'),
    ('CommandApproval_commandRequestId_idx', 'command_approvals_commandRequestId_idx'),
    ('ExecutionLog_commandRequestId_idx', 'execution_logs_commandRequestId_idx'),
    ('ExecutionLog_serverId_idx', 'execution_logs_serverId_idx'),
    ('FileEntry_parentId_idx', 'file_entries_parentId_idx'),
    ('FileEntry_storageNodeId_entryType_isDeleted_idx', 'file_entries_storageNodeId_entryType_isDeleted_idx')
  ) AS v(old_name, new_name) LOOP
    IF to_regclass(format('%I', r.old_name)) IS NOT NULL AND to_regclass(format('%I', r.new_name)) IS NULL THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;
