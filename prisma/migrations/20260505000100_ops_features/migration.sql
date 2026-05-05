-- Add operations, sharing, backup and deployment models
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "storageNodeId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "entryType" "FileEntryType" NOT NULL DEFAULT 'FILE',
    "name" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filePath" TEXT NOT NULL,
    "fileSize" TEXT,
    "note" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "deployment_runs" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "commandRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "variables" JSONB NOT NULL,
    "renderedCommand" TEXT NOT NULL,
    "serverIds" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    CONSTRAINT "deployment_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");
CREATE INDEX "share_links_storageNodeId_path_idx" ON "share_links"("storageNodeId", "path");
CREATE INDEX "share_links_expiresAt_idx" ON "share_links"("expiresAt");
CREATE INDEX "backup_records_status_createdAt_idx" ON "backup_records"("status", "createdAt");
CREATE INDEX "deployment_runs_status_createdAt_idx" ON "deployment_runs"("status", "createdAt");

ALTER TABLE "share_links" ADD CONSTRAINT "share_links_storageNodeId_fkey" FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "command_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
