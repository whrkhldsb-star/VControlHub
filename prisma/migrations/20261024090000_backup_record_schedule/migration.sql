-- A schedule's retention pruned every backup of its customer: a 1-day
-- schedule deleted a 30-day schedule's archives. Record which schedule
-- produced each backup (null: manual).
ALTER TABLE "backup_records" ADD COLUMN "scheduleId" TEXT;

CREATE INDEX "backup_records_scheduleId_idx" ON "backup_records"("scheduleId");

ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "backup_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
