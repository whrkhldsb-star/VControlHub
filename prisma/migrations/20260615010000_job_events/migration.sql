-- TR-001 T13a: append-only event stream for the durable job workers so the
-- operation-tasks center can show a "view events" timeline (claim, heartbeat,
-- progress, completion, failure, recovery). The events are scoped to a single
-- jobId, ordered by createdAt, and cascade-deleted with the parent job.

CREATE TABLE IF NOT EXISTS "job_events" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "workerId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "job_events_jobId_createdAt_idx" ON "job_events"("jobId", "createdAt");
CREATE INDEX IF NOT EXISTS "job_events_type_createdAt_idx" ON "job_events"("type", "createdAt");

DO $$ BEGIN
    ALTER TABLE "job_events"
        ADD CONSTRAINT "job_events_jobId_fkey"
        FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
