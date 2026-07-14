-- Scope backup schedules to the active team, matching backup records and jobs.
ALTER TABLE "backup_schedules" ADD COLUMN "teamId" TEXT;

CREATE INDEX "backup_schedules_teamId_idx" ON "backup_schedules"("teamId");

ALTER TABLE "backup_schedules"
ADD CONSTRAINT "backup_schedules_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "teams"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
