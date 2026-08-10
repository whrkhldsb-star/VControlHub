ALTER TABLE "ai_hosted_actions"
ADD COLUMN "toolCallId" TEXT;

CREATE INDEX "ai_hosted_actions_toolCallId_idx"
ON "ai_hosted_actions"("toolCallId");
