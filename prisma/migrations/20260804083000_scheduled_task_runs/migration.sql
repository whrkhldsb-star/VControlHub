CREATE TABLE "scheduled_task_runs" (
    "id" TEXT NOT NULL,
    "scheduledTaskId" TEXT NOT NULL,
    "commandRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_task_runs_commandRequestId_key" ON "scheduled_task_runs"("commandRequestId");
CREATE INDEX "scheduled_task_runs_status_dispatchedAt_idx" ON "scheduled_task_runs"("status", "dispatchedAt");
CREATE INDEX "scheduled_task_runs_scheduledTaskId_dispatchedAt_idx" ON "scheduled_task_runs"("scheduledTaskId", "dispatchedAt");

ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_scheduledTaskId_fkey"
  FOREIGN KEY ("scheduledTaskId") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_commandRequestId_fkey"
  FOREIGN KEY ("commandRequestId") REFERENCES "command_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
