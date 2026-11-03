-- A10-10: foreign keys that cascades and lookups scan without an index.
CREATE INDEX IF NOT EXISTS "rdp_tickets_serverId_idx" ON "rdp_tickets"("serverId");
CREATE INDEX IF NOT EXISTS "media_upload_sessions_storageNodeId_idx" ON "media_upload_sessions"("storageNodeId");
CREATE INDEX IF NOT EXISTS "media_upload_sessions_resultImageId_idx" ON "media_upload_sessions"("resultImageId");
