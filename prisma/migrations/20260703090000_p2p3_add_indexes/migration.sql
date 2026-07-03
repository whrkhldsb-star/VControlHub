-- P2 #14/#36: add missing @@index on foreign keys and FileEntry composite index
-- P3 #42: rename remaining PascalCase tables to snake_case (@@map)
-- Non-destructive: CREATE INDEX + ALTER TABLE RENAME only, no data changes.

-- ── New indexes on existing tables (pre-rename names) ──────────────

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "SshKey_createdById_idx" ON "SshKey"("createdById");

-- CreateIndex
CREATE INDEX "CommandApproval_commandRequestId_idx" ON "CommandApproval"("commandRequestId");

-- CreateIndex
CREATE INDEX "CommandApproval_approverId_idx" ON "CommandApproval"("approverId");

-- CreateIndex
CREATE INDEX "ExecutionLog_commandRequestId_idx" ON "ExecutionLog"("commandRequestId");

-- CreateIndex
CREATE INDEX "ExecutionLog_serverId_idx" ON "ExecutionLog"("serverId");

-- CreateIndex
CREATE INDEX "FileEntry_parentId_idx" ON "FileEntry"("parentId");

-- CreateIndex
CREATE INDEX "FileEntry_storageNodeId_entryType_isDeleted_idx" ON "FileEntry"("storageNodeId", "entryType", "isDeleted");

-- CreateIndex (CommandTarget was already renamed to command_targets in an earlier migration)
CREATE INDEX "command_targets_commandRequestId_idx" ON "command_targets"("commandRequestId");

-- CreateIndex (SyncLog was created as sync_logs)
CREATE INDEX "sync_logs_syncJobId_idx" ON "sync_logs"("syncJobId");

-- ── Rename PascalCase tables to snake_case (#42) ───────────────────

ALTER TABLE "User" RENAME TO "users";
ALTER TABLE "Role" RENAME TO "roles";
ALTER TABLE "Permission" RENAME TO "permissions";
ALTER TABLE "UserRole" RENAME TO "user_roles";
ALTER TABLE "RolePermission" RENAME TO "role_permissions";
ALTER TABLE "SshKey" RENAME TO "ssh_keys";
ALTER TABLE "CommandApproval" RENAME TO "command_approvals";
ALTER TABLE "ExecutionLog" RENAME TO "execution_logs";
ALTER TABLE "StorageNode" RENAME TO "storage_nodes";
ALTER TABLE "FileEntry" RENAME TO "file_entries";

-- Rename primary key indexes to match new table names
ALTER INDEX "User_pkey" RENAME TO "users_pkey";
ALTER INDEX "Role_pkey" RENAME TO "roles_pkey";
ALTER INDEX "Permission_pkey" RENAME TO "permissions_pkey";
ALTER INDEX "UserRole_pkey" RENAME TO "user_roles_pkey";
ALTER INDEX "RolePermission_pkey" RENAME TO "role_permissions_pkey";
ALTER INDEX "SshKey_pkey" RENAME TO "ssh_keys_pkey";
ALTER INDEX "CommandApproval_pkey" RENAME TO "command_approvals_pkey";
ALTER INDEX "ExecutionLog_pkey" RENAME TO "execution_logs_pkey";
ALTER INDEX "StorageNode_pkey" RENAME TO "storage_nodes_pkey";
ALTER INDEX "FileEntry_pkey" RENAME TO "file_entries_pkey";

-- Rename unique constraint indexes to match new table names
ALTER INDEX "User_username_key" RENAME TO "users_username_key";
ALTER INDEX "Role_key_key" RENAME TO "roles_key_key";
ALTER INDEX "Permission_key_key" RENAME TO "permissions_key_key";
ALTER INDEX "SshKey_fingerprint_key" RENAME TO "ssh_keys_fingerprint_key";
ALTER INDEX "StorageNode_serverId_key" RENAME TO "storage_nodes_serverId_key";
ALTER INDEX "FileEntry_storageNodeId_relativePath_key" RENAME TO "file_entries_storageNodeId_relativePath_key";
