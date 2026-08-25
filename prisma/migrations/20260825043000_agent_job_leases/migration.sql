ALTER TABLE "server_agent_jobs"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "server_agent_jobs_serverId_status_leaseExpiresAt_idx"
  ON "server_agent_jobs"("serverId", "status", "leaseExpiresAt");
