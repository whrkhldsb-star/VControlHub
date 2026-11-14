-- Indexes that repeat another index on the same table: each has the same columns as a unique constraint's
-- index or as another index, or is the leading column of a composite index. They are kept up to date on every
-- write and never needed for a read, so they go. The unique constraints and the indexes they repeat stay.
DROP INDEX IF EXISTS "cost_snapshots_snapshotDate_idx";                    -- same as cost_snapshots_snapshotDate_key
DROP INDEX IF EXISTS "server_uptime_snapshots_serverId_date_idx";          -- same as server_uptime_snapshots_serverId_date_key
DROP INDEX IF EXISTS "cost_entries_sourceType_sourceRef_effectiveDate_idx"; -- same as cost_entries_sourceType_sourceRef_effectiveDate_key
DROP INDEX IF EXISTS "deployment_runs_snapshotId_idx";                     -- same as deployment_runs_snapshotId_key
DROP INDEX IF EXISTS "media_items_storageNodeId_idx";                      -- leading column of media_items_storageNodeId_mediaType_idx

-- app_source_apps has two indexes on (source_id, category): the original one kept its old name when the
-- column was renamed, and the schema-alignment migration added the one the schema names. Drop the old one
-- only where the other exists.
DO $$
BEGIN
    IF to_regclass('app_source_apps_source_id_category_idx') IS NOT NULL THEN
        DROP INDEX IF EXISTS "app_source_apps_sourceId_category_idx";
    END IF;
END $$;
