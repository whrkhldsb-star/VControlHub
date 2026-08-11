CREATE TYPE "ServerManagementMode" AS ENUM ('DIRECT', 'AGENT');
CREATE TYPE "ServerAgentJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "servers"
  ADD COLUMN "managementMode" "ServerManagementMode" NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN "agentTokenHash" TEXT,
  ADD COLUMN "agentLastSeenAt" TIMESTAMP(3),
  ADD COLUMN "agentMetricsAt" TIMESTAMP(3),
  ADD COLUMN "agentMetricsRaw" TEXT,
  ADD COLUMN "agentVersion" TEXT,
  ADD COLUMN "agentCapabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "agentLastError" TEXT;

CREATE TABLE "server_agent_jobs" (
  "id" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "commandTargetId" TEXT,
  "command" TEXT NOT NULL,
  "status" "ServerAgentJobStatus" NOT NULL DEFAULT 'PENDING',
  "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
  "stdout" TEXT,
  "stderr" TEXT,
  "exitCode" INTEGER,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "server_agent_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "server_agent_jobs_serverId_status_createdAt_idx" ON "server_agent_jobs"("serverId", "status", "createdAt");
CREATE INDEX "server_agent_jobs_commandTargetId_status_idx" ON "server_agent_jobs"("commandTargetId", "status");
CREATE INDEX "server_agent_jobs_status_createdAt_idx" ON "server_agent_jobs"("status", "createdAt");
ALTER TABLE "server_agent_jobs" ADD CONSTRAINT "server_agent_jobs_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
