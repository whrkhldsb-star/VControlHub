-- Ticket SLA fields + escalation audit table (schema had them; no prior migration on fresh installs).

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "slaDueAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "escalatedTo" TEXT;

CREATE INDEX IF NOT EXISTS "tickets_slaDueAt_idx" ON "tickets"("slaDueAt");
CREATE INDEX IF NOT EXISTS "tickets_category_status_idx" ON "tickets"("category", "status");

CREATE TABLE IF NOT EXISTS "ticket_escalations" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT,
    "fromPriority" TEXT,
    "toPriority" TEXT,
    "fromAssignee" TEXT,
    "toAssignee" TEXT,
    "reason" TEXT,
    "escalatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_escalations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ticket_escalations_ticketId_createdAt_idx"
  ON "ticket_escalations"("ticketId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ticket_escalations"
    ADD CONSTRAINT "ticket_escalations_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
