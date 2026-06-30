-- TR-041: OS Dialect adaptation layer.
-- Adds osDialect (JSON-serialized OsDialect) and osInfo (human-readable OS summary)
-- to the servers table. Both nullable — existing servers default to null,
-- which the application interprets as "not yet detected, use Debian/Ubuntu default".

ALTER TABLE "servers" ADD COLUMN "osDialect" TEXT;
ALTER TABLE "servers" ADD COLUMN "osInfo" TEXT;
