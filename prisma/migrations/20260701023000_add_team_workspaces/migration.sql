-- Add multi-tenant team workspace foundation (TR-030)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "currentTeamId" TEXT;

CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("teamId", "userId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_key" ON "teams"("slug");
CREATE INDEX IF NOT EXISTS "teams_ownerId_idx" ON "teams"("ownerId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members"("userId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'teams_ownerId_fkey'
    ) THEN
        ALTER TABLE "teams" ADD CONSTRAINT "teams_ownerId_fkey"
        FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'team_members_teamId_fkey'
    ) THEN
        ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'team_members_userId_fkey'
    ) THEN
        ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'User_currentTeamId_fkey'
    ) THEN
        ALTER TABLE "User" ADD CONSTRAINT "User_currentTeamId_fkey"
        FOREIGN KEY ("currentTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
