-- Align fresh-install database schema with current Prisma mappings.
-- The previous migration history left several early models in their pre-@@map
-- table names on fresh installs (for example "Server" instead of "servers"),
-- while runtime Prisma queries use the mapped table names. That caused many
-- authenticated pages to hit Prisma P2021/P2022 errors immediately after a
-- one-click install.

-- Canonicalize tables that now use @@map.
ALTER TABLE IF EXISTS "Server" RENAME TO "servers";
ALTER TABLE IF EXISTS "DownloadTask" RENAME TO "download_tasks";

-- Keep indexes/foreign-key names non-critical; Prisma queries care about table
-- and column shape. The guarded DDL below is safe for both drifted fresh installs
-- and partially-correct upgraded databases.
ALTER TABLE IF EXISTS "servers" ADD COLUMN IF NOT EXISTS "publicUrl" TEXT;
ALTER TABLE IF EXISTS "servers" ADD COLUMN IF NOT EXISTS "fileProxyPort" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "aria2Gid" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "maxSpeedKb" INTEGER;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "totalBytes" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "completedBytes" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "downloadSpeed" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "fileSize" TEXT;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "isBatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS "download_tasks" ADD COLUMN IF NOT EXISTS "batchUrls" TEXT;

CREATE TABLE IF NOT EXISTS "quick_services" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "icon" TEXT NOT NULL DEFAULT '☁️',
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "path" TEXT NOT NULL DEFAULT '',
    "internalPort" INTEGER,
    "extraPortsJson" TEXT NOT NULL DEFAULT '[]',
    "command" TEXT,
    "envJson" TEXT NOT NULL DEFAULT '{}',
    "volumesJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'available',
    "containerId" TEXT,
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quick_services_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "quick_services_slug_key" ON "quick_services"("slug");
CREATE INDEX IF NOT EXISTS "quick_services_category_status_idx" ON "quick_services"("category", "status");

CREATE TABLE IF NOT EXISTS "image_uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "album" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "storageNodeId" TEXT,
    "relativePath" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "image_uploads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "image_uploads_userId_createdAt_idx" ON "image_uploads"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "image_uploads_album_idx" ON "image_uploads"("album");
CREATE INDEX IF NOT EXISTS "image_uploads_isPublic_createdAt_idx" ON "image_uploads"("isPublic", "createdAt");

DO $$ BEGIN
    CREATE TYPE "AiHostedActionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE IF EXISTS "ai_conversations" ADD COLUMN IF NOT EXISTS "hostingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS "ai_messages" ADD COLUMN IF NOT EXISTS "toolCallId" TEXT;
ALTER TABLE IF EXISTS "ai_messages" ADD COLUMN IF NOT EXISTS "toolCalls" TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "ai_messages_toolCallId_idx" ON "ai_messages"("toolCallId");

CREATE TABLE IF NOT EXISTS "ai_hosted_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "serverId" TEXT,
    "actionType" TEXT NOT NULL,
    "actionName" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "status" "AiHostedActionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT,
    "errorMessage" TEXT,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ai_hosted_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_hosted_actions_status_createdAt_idx" ON "ai_hosted_actions"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_hosted_actions_conversationId_createdAt_idx" ON "ai_hosted_actions"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_hosted_actions_serverId_status_idx" ON "ai_hosted_actions"("serverId", "status");

CREATE TABLE IF NOT EXISTS "server_file_proxies" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "proxyType" TEXT NOT NULL DEFAULT 'python_http',
    "port" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "pid" INTEGER,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "server_file_proxies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "server_file_proxies_serverId_status_idx" ON "server_file_proxies"("serverId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "server_file_proxies_serverId_proxyType_key" ON "server_file_proxies"("serverId", "proxyType");

-- Earlier app-source migration used camelCase physical columns. Current schema
-- maps them to snake_case, so fresh installs must rename without dropping data.
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "displayName" TO "display_name";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "syncInterval" TO "sync_interval";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "lastSyncAt" TO "last_sync_at";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "lastSyncStatus" TO "last_sync_status";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "lastSyncError" TO "last_sync_error";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "syncCount" TO "sync_count";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "configJson" TO "config_json";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE IF EXISTS "app_sources" RENAME COLUMN "updatedAt" TO "updated_at";

ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "sourceId" TO "source_id";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "defaultPort" TO "default_port";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "internalPort" TO "internal_port";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "envJson" TO "env_json";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "volumesJson" TO "volumes_json";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "extraPortsJson" TO "extra_ports_json";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "rawJson" TO "raw_json";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "sourceVersion" TO "source_version";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE IF EXISTS "app_source_apps" RENAME COLUMN "updatedAt" TO "updated_at";

CREATE INDEX IF NOT EXISTS "servers_host_port_idx" ON "servers"("host", "port");
CREATE INDEX IF NOT EXISTS "servers_enabled_idx" ON "servers"("enabled");
CREATE INDEX IF NOT EXISTS "download_tasks_serverId_status_idx" ON "download_tasks"("serverId", "status");
CREATE INDEX IF NOT EXISTS "download_tasks_status_createdAt_idx" ON "download_tasks"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_createdBy_name_key" ON "ai_providers"("createdBy", "name");
CREATE INDEX IF NOT EXISTS "ai_providers_enabled_idx" ON "ai_providers"("enabled");
CREATE INDEX IF NOT EXISTS "app_source_apps_source_id_category_idx" ON "app_source_apps"("source_id", "category");
CREATE INDEX IF NOT EXISTS "app_source_apps_category_idx" ON "app_source_apps"("category");
