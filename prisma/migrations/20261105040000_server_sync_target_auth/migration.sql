-- How a sync job's source logs in to a server that is its target. Servers that exist now keep the way
-- sync has always worked ('credential': the server's own key or password is copied to the source).
ALTER TABLE "servers" ADD COLUMN "syncTargetAuth" TEXT NOT NULL DEFAULT 'credential';
-- Servers added from now on follow the setting sync.targetAuthDefault until they are given their own choice.
ALTER TABLE "servers" ALTER COLUMN "syncTargetAuth" SET DEFAULT 'inherit';
