-- Tables present in schema/product code but missing from migration history on fresh installs.
-- server_uptime_snapshots previously only had a no-op migration (assumed db push).
-- role_templates / share_access_logs never had a CREATE migration.

CREATE TABLE IF NOT EXISTS "server_uptime_snapshots" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "uptimePercent" DOUBLE PRECISION NOT NULL,
    "onlineMinutes" INTEGER NOT NULL,
    "offlineMinutes" INTEGER NOT NULL,
    "checkCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_uptime_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "server_uptime_snapshots_serverId_date_key"
  ON "server_uptime_snapshots"("serverId", "date");
CREATE INDEX IF NOT EXISTS "server_uptime_snapshots_serverId_date_idx"
  ON "server_uptime_snapshots"("serverId", "date");

DO $$ BEGIN
  ALTER TABLE "server_uptime_snapshots"
    ADD CONSTRAINT "server_uptime_snapshots_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "role_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleKeys" TEXT[],
    "permissions" TEXT[],
    "dataScope" JSONB,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "role_templates_name_idx" ON "role_templates"("name");

DO $$ BEGIN
  ALTER TABLE "role_templates"
    ADD CONSTRAINT "role_templates_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "share_access_logs" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "share_access_logs_shareLinkId_accessedAt_idx"
  ON "share_access_logs"("shareLinkId", "accessedAt");

DO $$ BEGIN
  ALTER TABLE "share_access_logs"
    ADD CONSTRAINT "share_access_logs_shareLinkId_fkey"
    FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
