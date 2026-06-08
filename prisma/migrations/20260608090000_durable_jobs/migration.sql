-- Durable background job queue base table.
DO $$ BEGIN
    CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" TEXT,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "workerId" TEXT,
    "workerHeartbeatAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "jobs_status_availableAt_priority_createdAt_idx" ON "jobs"("status", "availableAt", "priority", "createdAt");
CREATE INDEX IF NOT EXISTS "jobs_status_leaseExpiresAt_idx" ON "jobs"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "jobs_type_status_idx" ON "jobs"("type", "status");
CREATE INDEX IF NOT EXISTS "jobs_createdBy_createdAt_idx" ON "jobs"("createdBy", "createdAt");

DO $$ BEGIN
    ALTER TABLE "jobs" ADD CONSTRAINT "jobs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
