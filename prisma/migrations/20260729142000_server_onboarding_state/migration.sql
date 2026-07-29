CREATE TYPE "ServerOnboardingStatus" AS ENUM ('READY', 'DRAFT', 'NEEDS_ATTENTION');
CREATE TYPE "DirectGatewayProtocol" AS ENUM ('http', 'https');

ALTER TABLE "servers"
  ADD COLUMN "onboardingStatus" "ServerOnboardingStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "onboardingLastError" TEXT,
  ADD COLUMN "directGatewayDesiredEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "directGatewayDesiredProtocol" "DirectGatewayProtocol" NOT NULL DEFAULT 'http',
  ADD COLUMN "directGatewayDesiredDomain" TEXT;

CREATE TYPE "WorkerRuntimeStatus" AS ENUM ('RUNNING', 'FAILED', 'STOPPED');

CREATE TABLE "worker_runtimes" (
  "id" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "status" "WorkerRuntimeStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  CONSTRAINT "worker_runtimes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_runtimes_workerId_instanceId_key"
  ON "worker_runtimes"("workerId", "instanceId");
CREATE INDEX "worker_runtimes_workerId_status_lastHeartbeatAt_idx"
  ON "worker_runtimes"("workerId", "status", "lastHeartbeatAt");
CREATE INDEX "worker_runtimes_instanceId_idx" ON "worker_runtimes"("instanceId");

CREATE TYPE "StorageHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'UNHEALTHY');
ALTER TABLE "StorageNode" ALTER COLUMN "healthStatus" DROP DEFAULT;
ALTER TABLE "StorageNode"
  ALTER COLUMN "healthStatus" TYPE "StorageHealthStatus"
  USING ("healthStatus"::text::"StorageHealthStatus");
ALTER TABLE "StorageNode" ALTER COLUMN "healthStatus" SET DEFAULT 'UNKNOWN';

CREATE TYPE "PlaybookRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
ALTER TABLE "playbook_runs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "playbook_runs"
  ALTER COLUMN "status" TYPE "PlaybookRunStatus"
  USING ("status"::text::"PlaybookRunStatus");
ALTER TABLE "playbook_runs" ALTER COLUMN "status" SET DEFAULT 'queued';

CREATE TYPE "AlertIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
ALTER TABLE "alert_incidents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "alert_incidents"
  ALTER COLUMN "status" TYPE "AlertIncidentStatus"
  USING ("status"::text::"AlertIncidentStatus");
ALTER TABLE "alert_incidents" ALTER COLUMN "status" SET DEFAULT 'OPEN';

CREATE TYPE "SyncLogStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
ALTER TABLE "sync_logs"
  ALTER COLUMN "status" TYPE "SyncLogStatus"
  USING ("status"::text::"SyncLogStatus");
