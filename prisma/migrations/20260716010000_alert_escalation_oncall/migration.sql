-- Alert multi-level escalation + on-call routing + incident ack
ALTER TABLE "alert_rules" ADD COLUMN IF NOT EXISTS "escalationMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "alert_rules" ADD COLUMN IF NOT EXISTS "onCallUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "alert_incidents" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "serverId" TEXT,
  "serverName" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "operator" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "level" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "escalatedAt" TIMESTAMP(3),
  "lastNotifiedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alert_incidents_fingerprint_key" ON "alert_incidents"("fingerprint");
CREATE INDEX IF NOT EXISTS "alert_incidents_status_level_createdAt_idx" ON "alert_incidents"("status", "level", "createdAt");
CREATE INDEX IF NOT EXISTS "alert_incidents_ruleId_status_idx" ON "alert_incidents"("ruleId", "status");
CREATE INDEX IF NOT EXISTS "alert_incidents_acknowledgedById_idx" ON "alert_incidents"("acknowledgedById");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_incidents_ruleId_fkey') THEN
    ALTER TABLE "alert_incidents"
      ADD CONSTRAINT "alert_incidents_ruleId_fkey"
      FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_incidents_acknowledgedById_fkey') THEN
    ALTER TABLE "alert_incidents"
      ADD CONSTRAINT "alert_incidents_acknowledgedById_fkey"
      FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
