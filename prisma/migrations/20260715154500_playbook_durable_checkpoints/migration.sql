-- Durable Playbook execution checkpoints and command idempotency.
ALTER TABLE "command_requests"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "command_requests_idempotencyKey_key"
  ON "command_requests"("idempotencyKey");

ALTER TABLE "playbook_runs"
  ADD COLUMN IF NOT EXISTS "jobId" TEXT,
  ADD COLUMN IF NOT EXISTS "executionState" JSONB,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "playbook_runs_jobId_key"
  ON "playbook_runs"("jobId");
