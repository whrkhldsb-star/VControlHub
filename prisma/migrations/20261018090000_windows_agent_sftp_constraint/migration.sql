-- Windows nodes support Agent mode (token issued on install) and an optional
-- SFTP binding whose password is stored in "password" (see
-- service-profiles-windows.ts); the original check forbade both, so every such
-- save failed on databases built from migrations. Windows never uses an SSH
-- key, which stays forbidden.
ALTER TABLE "servers" DROP CONSTRAINT IF EXISTS "servers_windows_isolation_check";
ALTER TABLE "servers" ADD CONSTRAINT "servers_windows_isolation_check" CHECK ("operatingSystem" <> 'WINDOWS' OR "sshKeyId" IS NULL);
