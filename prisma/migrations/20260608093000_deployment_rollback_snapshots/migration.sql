-- Add rollback metadata to deployment templates.
ALTER TABLE "command_templates" ADD COLUMN "rollbackCommand" TEXT;

-- Preserve immutable deployment snapshots for real rollback actions.
CREATE TABLE "deployment_snapshots" (
  "id" TEXT NOT NULL,
  "sourceRunId" TEXT,
  "templateId" TEXT NOT NULL,
  "templateName" TEXT NOT NULL,
  "deployCommand" TEXT NOT NULL,
  "rollbackCommand" TEXT,
  "variables" JSONB NOT NULL,
  "serverIds" TEXT[] NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deployment_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deployment_snapshots_sourceRunId_key" ON "deployment_snapshots"("sourceRunId");
CREATE INDEX "deployment_snapshots_templateId_createdAt_idx" ON "deployment_snapshots"("templateId", "createdAt");
CREATE INDEX "deployment_snapshots_createdAt_idx" ON "deployment_snapshots"("createdAt");

ALTER TABLE "deployment_runs" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "deployment_runs" ADD COLUMN "rollbackOfRunId" TEXT;
CREATE UNIQUE INDEX "deployment_runs_snapshotId_key" ON "deployment_runs"("snapshotId");
CREATE INDEX "deployment_runs_rollbackOfRunId_idx" ON "deployment_runs"("rollbackOfRunId");

CREATE TABLE "deployment_rollback_runs" (
  "id" TEXT NOT NULL,
  "sourceRunId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "commandRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "rollbackCommand" TEXT NOT NULL,
  "serverIds" TEXT[] NOT NULL,
  "reason" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "deployment_rollback_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deployment_rollback_runs_sourceRunId_createdAt_idx" ON "deployment_rollback_runs"("sourceRunId", "createdAt");
CREATE INDEX "deployment_rollback_runs_snapshotId_createdAt_idx" ON "deployment_rollback_runs"("snapshotId", "createdAt");
CREATE INDEX "deployment_rollback_runs_status_createdAt_idx" ON "deployment_rollback_runs"("status", "createdAt");

ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "deployment_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_rollbackOfRunId_fkey" FOREIGN KEY ("rollbackOfRunId") REFERENCES "deployment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployment_snapshots" ADD CONSTRAINT "deployment_snapshots_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "deployment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployment_rollback_runs" ADD CONSTRAINT "deployment_rollback_runs_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "deployment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_rollback_runs" ADD CONSTRAINT "deployment_rollback_runs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "deployment_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_rollback_runs" ADD CONSTRAINT "deployment_rollback_runs_commandRequestId_fkey" FOREIGN KEY ("commandRequestId") REFERENCES "command_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployment_rollback_runs" ADD CONSTRAINT "deployment_rollback_runs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
