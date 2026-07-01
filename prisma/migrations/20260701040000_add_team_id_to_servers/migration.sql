-- Migration: add team_id to servers table for multi-tenancy resource isolation
-- TR-030: Multi-tenancy / Team Workspaces

-- Add teamId column to servers table (nullable — existing servers have no team)
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

-- Add index for team-scoped queries
CREATE INDEX IF NOT EXISTS "servers_teamId_idx" ON "servers"("teamId");

-- Add foreign key constraint
ALTER TABLE "servers" ADD CONSTRAINT "servers_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL;
