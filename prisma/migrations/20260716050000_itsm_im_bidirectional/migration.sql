-- FEAT-ITSM-IM-BIDI: ITSM/IM bidirectional connections + event log
CREATE TABLE IF NOT EXISTS "itsm_connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'bidirectional',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credentialsEnc" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "teamId" TEXT,
    "lastOutboundAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "itsm_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "itsm_events" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "direction" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ticketId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "itsm_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "itsm_connections_provider_enabled_idx" ON "itsm_connections"("provider", "enabled");
CREATE INDEX IF NOT EXISTS "itsm_connections_teamId_idx" ON "itsm_connections"("teamId");
CREATE INDEX IF NOT EXISTS "itsm_connections_createdById_idx" ON "itsm_connections"("createdById");
CREATE INDEX IF NOT EXISTS "itsm_events_ticketId_createdAt_idx" ON "itsm_events"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "itsm_events_direction_createdAt_idx" ON "itsm_events"("direction", "createdAt");
CREATE INDEX IF NOT EXISTS "itsm_events_status_createdAt_idx" ON "itsm_events"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "itsm_events_connectionId_externalId_key"
  ON "itsm_events"("connectionId", "externalId");

DO $$ BEGIN
  ALTER TABLE "itsm_connections"
    ADD CONSTRAINT "itsm_connections_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "itsm_events"
    ADD CONSTRAINT "itsm_events_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "itsm_connections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
