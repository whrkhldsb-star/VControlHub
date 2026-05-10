-- Add missing tables and columns that the schema requires but migrations omitted.
-- This migration brings the database in sync with schema.prisma.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Add missing columns to existing tables
-- ═══════════════════════════════════════════════════════════════════

-- StorageNode: health monitoring columns
ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3);
ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "lastHealthError" TEXT;
ALTER TABLE "StorageNode" ADD COLUMN IF NOT EXISTS "lastHealthLatencyMs" INTEGER;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Create missing enums
-- ═══════════════════════════════════════════════════════════════════

DO $$ BEGIN
    CREATE TYPE "AiProviderType" AS ENUM ('OPENAI', 'OPENAI_COMPATIBLE', 'ANTHROPIC', 'GOOGLE', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Create missing tables
-- ═══════════════════════════════════════════════════════════════════

-- Snippets
CREATE TABLE IF NOT EXISTS "snippets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "snippets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "snippets_createdBy_updatedAt_idx" ON "snippets"("createdBy", "updatedAt");

-- API Tokens
CREATE TABLE IF NOT EXISTS "api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenSuffix" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "api_tokens_createdBy_revokedAt_idx" ON "api_tokens"("createdBy", "revokedAt");

-- Announcements
CREATE TABLE IF NOT EXISTS "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "announcements_published_pinned_startsAt_idx" ON "announcements"("published", "pinned", "startsAt");

-- Media Items
CREATE TABLE IF NOT EXISTS "media_items" (
    "id" TEXT NOT NULL,
    "fileEntryId" TEXT,
    "storageNodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "size" BIGINT,
    "tags" TEXT[],
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "media_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "media_items_fileEntryId_key" ON "media_items"("fileEntryId");
CREATE INDEX IF NOT EXISTS "media_items_storageNodeId_mediaType_idx" ON "media_items"("storageNodeId", "mediaType");
CREATE INDEX IF NOT EXISTS "media_items_favorite_updatedAt_idx" ON "media_items"("favorite", "updatedAt");

-- Tickets
CREATE TABLE IF NOT EXISTS "tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdBy" TEXT NOT NULL,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tickets_status_priority_createdAt_idx" ON "tickets"("status", "priority", "createdAt");

-- Ticket Comments
CREATE TABLE IF NOT EXISTS "ticket_comments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_comments_ticketId_createdAt_idx" ON "ticket_comments"("ticketId", "createdAt");

-- Deployment Exports
CREATE TABLE IF NOT EXISTS "deployment_exports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PORTABLE_PACKAGE',
    "manifest" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployment_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "deployment_exports_createdAt_idx" ON "deployment_exports"("createdAt");

-- AI Providers
CREATE TABLE IF NOT EXISTS "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AiProviderType" NOT NULL DEFAULT 'OPENAI_COMPATIBLE',
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4o',
    "availableModels" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_providers_createdBy_idx" ON "ai_providers"("createdBy");

-- AI Conversations
CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "topP" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "frequencyPenalty" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "presencePenalty" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "enableVision" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_conversations_createdBy_updatedAt_idx" ON "ai_conversations"("createdBy", "updatedAt");

-- AI Messages
CREATE TABLE IF NOT EXISTS "ai_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoningContent" TEXT,
    "imageUrls" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- ═══════════════════════════════════════════════════════════════════
-- 4. Add missing foreign keys
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE "snippets" ADD CONSTRAINT "snippets_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_items" ADD CONSTRAINT "media_items_storageNodeId_fkey"
    FOREIGN KEY ("storageNodeId") REFERENCES "StorageNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_fileEntryId_fkey"
    FOREIGN KEY ("fileEntryId") REFERENCES "FileEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deployment_exports" ADD CONSTRAINT "deployment_exports_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
