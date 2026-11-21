-- A legacy conversation has no trustworthy record of its customer at creation.
ALTER TABLE "ai_conversations" ADD COLUMN "teamId" TEXT;
CREATE INDEX "ai_conversations_createdBy_teamId_updatedAt_idx" ON "ai_conversations"("createdBy", "teamId", "updatedAt");

ALTER TABLE "ai_ops_logs" ADD COLUMN "jobId" TEXT;
CREATE INDEX "ai_ops_logs_jobId_completedAt_idx" ON "ai_ops_logs"("jobId", "completedAt");
