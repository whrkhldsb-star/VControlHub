-- Add command worker ownership metadata for restart-surviving command queue claims.
ALTER TABLE "command_requests" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "command_requests" ADD COLUMN IF NOT EXISTS "workerHeartbeatAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "command_requests_status_workerHeartbeatAt_idx"
  ON "command_requests"("status", "workerHeartbeatAt");
