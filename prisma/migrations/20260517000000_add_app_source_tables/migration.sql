-- AlterTable
CREATE TABLE IF NOT EXISTS "app_sources" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'json',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "syncInterval" TEXT NOT NULL DEFAULT 'daily',
    "lastSyncAt" TIMESTAMPTZ,
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "app_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_source_apps" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "sourceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "icon" TEXT NOT NULL DEFAULT '📦',
    "description" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "defaultPort" INTEGER NOT NULL DEFAULT 8080,
    "internalPort" INTEGER,
    "path" TEXT NOT NULL DEFAULT '/',
    "envJson" TEXT NOT NULL DEFAULT '{}',
    "volumesJson" TEXT NOT NULL DEFAULT '[]',
    "command" TEXT,
    "extraPortsJson" TEXT NOT NULL DEFAULT '[]',
    "rawJson" TEXT,
    "sourceVersion" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "app_source_apps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_source_apps_sourceId_category_idx" ON "app_source_apps"("sourceId", "category");
CREATE INDEX "app_source_apps_category_idx" ON "app_source_apps"("category");
CREATE UNIQUE INDEX "app_sources_name_key" ON "app_sources"("name");
CREATE UNIQUE INDEX "app_source_apps_slug_key" ON "app_source_apps"("slug");
ALTER TABLE "app_source_apps" ADD CONSTRAINT "app_source_apps_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "app_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
