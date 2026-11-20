-- A connection could be reassigned before C13. Neither its current owner nor
-- the optional ticket reference proves who owned its historical payload.
ALTER TABLE "itsm_events" ADD COLUMN "teamId" TEXT,
                         ADD COLUMN "ownerBound" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "itsm_events_teamId_createdAt_idx" ON "itsm_events" ("teamId", "createdAt");
