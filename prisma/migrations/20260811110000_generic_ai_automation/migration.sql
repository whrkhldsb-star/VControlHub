-- Generic AI automation plans and one-time scheduling.
CREATE TYPE "ScheduledTaskType" AS ENUM ('CRON', 'ONCE');
CREATE TYPE "AiAutomationMode" AS ENUM ('ASSISTED', 'PLAN_ONLY');

ALTER TABLE "scheduled_tasks"
  ADD COLUMN "scheduleType" "ScheduledTaskType" NOT NULL DEFAULT 'CRON',
  ADD COLUMN "runAt" TIMESTAMP(3),
  ADD COLUMN "plan" TEXT,
  ADD COLUMN "verificationCommand" TEXT,
  ADD COLUMN "rollbackCommand" TEXT,
  ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "templateId" TEXT;

ALTER TABLE "ai_conversations"
  ADD COLUMN "automationMode" "AiAutomationMode" NOT NULL DEFAULT 'ASSISTED';

-- Existing cron tasks were historically dispatched without command approval.
-- Preserve that behavior; newly created tasks use the schema/service default.
UPDATE "scheduled_tasks" SET "approvalRequired" = false;

CREATE INDEX "scheduled_tasks_templateId_idx" ON "scheduled_tasks"("templateId");
ALTER TABLE "scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "command_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
