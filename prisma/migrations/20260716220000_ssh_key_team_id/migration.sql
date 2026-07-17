-- SSH keys multi-tenant scope (null = shared/legacy)
ALTER TABLE "SshKey" ADD COLUMN IF NOT EXISTS "teamId" TEXT;
CREATE INDEX IF NOT EXISTS "SshKey_teamId_idx" ON "SshKey"("teamId");
DO $$ BEGIN
  ALTER TABLE "SshKey"
    ADD CONSTRAINT "SshKey_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
