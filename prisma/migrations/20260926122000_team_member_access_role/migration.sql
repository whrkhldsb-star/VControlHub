-- Existing memberships retain their current account-level permissions until
-- a workspace administrator chooses a narrower workspace access role.
ALTER TABLE "team_members" ADD COLUMN "accessRole" TEXT NOT NULL DEFAULT 'inherit';
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_accessRole_check"
  CHECK ("accessRole" IN ('inherit', 'operator', 'viewer', 'storage_manager'));
