-- Nullable, additive recovery journal; previous runtimes can ignore the column.
ALTER TABLE "download_tasks" ADD COLUMN "transferManifest" JSONB;
