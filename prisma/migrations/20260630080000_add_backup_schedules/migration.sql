-- TR-038: First-class backup schedules.
-- Previously the only way to "schedule" a backup was to wrap the local backup
-- shell command in a generic scheduled_tasks row, but scheduled-task dispatch
-- runs the command on remote VPS targets via SSH — while `deploy/backup.sh`
-- only exists on the VControlHub host. The workaround was architecturally
-- broken. backup_schedules is a dedicated table; the schedule tick worker
-- creates a PENDING backup_record and enqueues a `backup.create` durable job.

CREATE TABLE "backup_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "backupType" TEXT NOT NULL,
    "note" TEXT,
    "retentionDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_schedules_status_nextRunAt_idx" ON "backup_schedules"("status", "nextRunAt");

ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
