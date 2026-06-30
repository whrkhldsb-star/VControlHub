-- TR-043: VPS remote backup models.
-- Creates vps_backup_schedules and vps_backup_records tables for
-- backing up remote VPS nodes via SSH exec + SFTP download.
-- Note: "User" table has no @@map, so FK references "User" not "users".

CREATE TABLE "vps_backup_schedules" (
    "id"             TEXT     NOT NULL,
    "serverId"       TEXT     NOT NULL,
    "name"           TEXT     NOT NULL,
    "cronExpression" TEXT     NOT NULL,
    "backupType"     TEXT     NOT NULL,
    "paths"          TEXT[]   DEFAULT ARRAY[]::TEXT[],
    "note"           TEXT,
    "retentionDays"  INTEGER,
    "status"         TEXT     DEFAULT 'ACTIVE',
    "createdById"    TEXT,
    "lastRunAt"      TIMESTAMP(3),
    "nextRunAt"      TIMESTAMP(3),
    "lastResult"     TEXT,
    "runCount"       INTEGER  DEFAULT 0,
    "createdAt"      TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vps_backup_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vps_backup_records" (
    "id"                TEXT     NOT NULL,
    "scheduleId"        TEXT,
    "serverId"          TEXT     NOT NULL,
    "backupType"        TEXT     NOT NULL,
    "status"            TEXT     DEFAULT 'PENDING',
    "remotePath"        TEXT,
    "localPath"         TEXT,
    "fileSize"          TEXT,
    "checksumSha256"    TEXT,
    "errorMessage"      TEXT,
    "createdBy"         TEXT,
    "createdAt"         TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "completedAt"       TIMESTAMP(3),
    "offsiteKey"        TEXT,
    "offsiteUploadedAt" TIMESTAMP(3),
    "offsiteSize"       TEXT,

    CONSTRAINT "vps_backup_records_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "vps_backup_schedules"
    ADD CONSTRAINT "vps_backup_schedules_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE;

ALTER TABLE "vps_backup_schedules"
    ADD CONSTRAINT "vps_backup_schedules_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;

ALTER TABLE "vps_backup_records"
    ADD CONSTRAINT "vps_backup_records_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "vps_backup_schedules"("id") ON DELETE SET NULL;

ALTER TABLE "vps_backup_records"
    ADD CONSTRAINT "vps_backup_records_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE;

ALTER TABLE "vps_backup_records"
    ADD CONSTRAINT "vps_backup_records_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL;

-- Indexes
CREATE INDEX "vps_backup_schedules_status_nextRunAt_idx"
    ON "vps_backup_schedules"("status", "nextRunAt");
CREATE INDEX "vps_backup_schedules_serverId_idx"
    ON "vps_backup_schedules"("serverId");
CREATE INDEX "vps_backup_records_status_createdAt_idx"
    ON "vps_backup_records"("status", "createdAt");
CREATE INDEX "vps_backup_records_serverId_idx"
    ON "vps_backup_records"("serverId");
CREATE INDEX "vps_backup_records_scheduleId_idx"
    ON "vps_backup_records"("scheduleId");
