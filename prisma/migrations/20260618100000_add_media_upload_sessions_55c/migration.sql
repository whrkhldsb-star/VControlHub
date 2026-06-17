-- TR-009 55c: Media resumable upload sessions.
--
-- 新表 media_upload_sessions: 跟踪分片 / 断点续传上传会话。
-- 客户端 init → 上传 N 个 chunk → complete 时服务端拼接 + 处理。
-- 临时 chunk 文件存在 /tmp 下 (MediaUploadSessionService), 不进 DB。
--
-- 字段:
--   id              TEXT PK     — cuid
--   userId          TEXT FK     — 上传者 (User 表, PascalCase)
--   filename        TEXT        — 原始文件名
--   mimeType        TEXT        — e.g. image/jpeg
--   totalSize       BIGINT      — 字节 (大文件用 BigInt)
--   chunkSize       INTEGER     — 单 chunk 字节 (e.g. 5MB)
--   totalChunks     INTEGER     — ceil(totalSize / chunkSize)
--   receivedChunks  INTEGER[]   — 已收到的 chunk 索引 (按序去重)
--   storageNodeId   TEXT? FK    — 目标存储节点 (StorageNode 表, optional)
--   relativePath    TEXT?       — 节点内子路径
--   status          enum        — PENDING / UPLOADING / COMPLETED / CANCELLED / FAILED
--   resultImageId   TEXT? FK    — 完成时关联到 image_uploads
--   checksum        TEXT?       — 拼接后 sha256
--   errorMessage    TEXT?       — 失败原因
--   expiresAt       TIMESTAMP(3) — TTL (默认 24h, 过期 sweeper 清)
--   completedAt     TIMESTAMP(3) — 完成时间
--   createdAt/updatedAt
--
-- 索引:
--   (userId, createdAt) — 用户上传历史
--   (status, expiresAt)  — sweeper 找过期 session
--
-- Wrapped in DO $$ / IF NOT EXISTS so re-running on a partially-migrated
-- DB doesn't blow up. PascalCase FK targets match VControlHub Prisma
-- schema (User / StorageNode have no @@map; image_uploads does).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaUploadSessionStatus') THEN
        CREATE TYPE "MediaUploadSessionStatus" AS ENUM (
            'PENDING',
            'UPLOADING',
            'COMPLETED',
            'CANCELLED',
            'FAILED'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_upload_sessions') THEN
        CREATE TABLE "media_upload_sessions" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "filename" TEXT NOT NULL,
            "mimeType" TEXT NOT NULL,
            "totalSize" BIGINT NOT NULL,
            "chunkSize" INTEGER NOT NULL,
            "totalChunks" INTEGER NOT NULL,
            "receivedChunks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
            "storageNodeId" TEXT,
            "relativePath" TEXT,
            "status" "MediaUploadSessionStatus" NOT NULL DEFAULT 'PENDING',
            "resultImageId" TEXT,
            "checksum" TEXT,
            "errorMessage" TEXT,
            "expiresAt" TIMESTAMP(3) NOT NULL,
            "completedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id")
        );
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "media_upload_sessions_userId_createdAt_idx" ON "media_upload_sessions"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "media_upload_sessions_status_expiresAt_idx" ON "media_upload_sessions"("status", "expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_upload_sessions_userId_fkey') THEN
        ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_upload_sessions_storageNodeId_fkey') THEN
        ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_storageNodeId_fkey"
            FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_upload_sessions_resultImageId_fkey') THEN
        ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_resultImageId_fkey"
            FOREIGN KEY ("resultImageId") REFERENCES "image_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;
