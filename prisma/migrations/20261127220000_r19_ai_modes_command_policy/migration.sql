-- R19: AI execution modes (AUTO, FULL_AUTO), pinned server context,
-- command risk/origin/decision tracking, and plain indexed commandRequestId
-- linkage on ai_hosted_actions (intentionally FK-less and non-unique to remain
-- 100% safe for automatic bare-metal upgrades via isAutomaticMigration).

ALTER TYPE "AiAutomationMode" ADD VALUE IF NOT EXISTS 'AUTO';
ALTER TYPE "AiAutomationMode" ADD VALUE IF NOT EXISTS 'FULL_AUTO';

CREATE TYPE "CommandOrigin" AS ENUM (
  'USER_UI',
  'API',
  'AI_CHAT',
  'AI_AUTOMATION',
  'DEPLOYMENT',
  'DEPLOYMENT_ROLLBACK',
  'SCHEDULED_TASK',
  'PLAYBOOK'
);

ALTER TABLE "command_requests"
  ADD COLUMN IF NOT EXISTS "origin" "CommandOrigin",
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "riskReasons" JSONB,
  ADD COLUMN IF NOT EXISTS "decisionSource" TEXT;

ALTER TABLE "ai_conversations"
  ADD COLUMN IF NOT EXISTS "automationModeExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinnedServerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ai_hosted_actions"
  ADD COLUMN IF NOT EXISTS "effectiveRisk" TEXT,
  ADD COLUMN IF NOT EXISTS "riskReasons" JSONB,
  ADD COLUMN IF NOT EXISTS "decisionSource" TEXT,
  ADD COLUMN IF NOT EXISTS "modeAtDecision" "AiAutomationMode",
  ADD COLUMN IF NOT EXISTS "commandRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "ai_hosted_actions_commandRequestId_idx"
  ON "ai_hosted_actions"("commandRequestId");
