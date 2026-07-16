-- CreateEnum
CREATE TYPE "FileVersionReason" AS ENUM ('UPLOAD', 'EDIT', 'MANUAL', 'RESTORE_POINT');

-- CreateTable
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "fileEntryId" TEXT NOT NULL,
    "storageNodeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "blobRelativePath" TEXT NOT NULL,
    "reason" "FileVersionReason" NOT NULL DEFAULT 'UPLOAD',
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_fileEntryId_versionNumber_key" ON "file_versions"("fileEntryId", "versionNumber");
CREATE INDEX "file_versions_fileEntryId_createdAt_idx" ON "file_versions"("fileEntryId", "createdAt");
CREATE INDEX "file_versions_storageNodeId_createdAt_idx" ON "file_versions"("storageNodeId", "createdAt");

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_fileEntryId_fkey" FOREIGN KEY ("fileEntryId") REFERENCES "file_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_storageNodeId_fkey" FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
