ALTER TYPE "StorageDriver" ADD VALUE 'AGENT';
CREATE TABLE "agent_file_shares" (
  id TEXT PRIMARY KEY, "storageNodeId" TEXT NOT NULL UNIQUE REFERENCES "StorageNode"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "serverId" TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "teamId" TEXT, "rootIdentity" TEXT, "tokenHash" TEXT, "agentHash" TEXT, "seenAt" TIMESTAMP(3), "lastReadAt" TIMESTAMP(3), "lastWriteAt" TIMESTAMP(3),
  writable BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "agent_file_shares_tokenHash_key" ON agent_file_shares("tokenHash");
CREATE INDEX "agent_file_shares_serverId_idx" ON agent_file_shares("serverId");
CREATE UNLOGGED TABLE "agent_file_calls" (
  id TEXT PRIMARY KEY, "shareId" TEXT NOT NULL REFERENCES agent_file_shares(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL, payload JSONB NOT NULL, claimed BOOLEAN NOT NULL DEFAULT false, result JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "agent_file_calls_shareId_claimed_expiresAt_idx" ON agent_file_calls("shareId", claimed, "expiresAt");
CREATE INDEX "agent_file_calls_expiresAt_idx" ON agent_file_calls("expiresAt");

-- A returned node or team must explicitly pair again even if its previous owner is restored.
CREATE FUNCTION vch_revoke_file_shares() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_file_shares SET "rootIdentity" = NULL, "tokenHash" = NULL, "agentHash" = NULL, "seenAt" = NULL,
    writable = FALSE, "lastReadAt" = NULL, "lastWriteAt" = NULL WHERE "serverId" = NEW.id;
  DELETE FROM agent_file_calls WHERE "shareId" IN (SELECT id FROM agent_file_shares WHERE "serverId" = NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER revoke_file_shares AFTER UPDATE OF "agentTokenHash", "managementMode", "teamId" ON servers
FOR EACH ROW WHEN (ROW(NEW."agentTokenHash", NEW."managementMode", NEW."teamId") IS DISTINCT FROM ROW(OLD."agentTokenHash", OLD."managementMode", OLD."teamId"))
EXECUTE FUNCTION vch_revoke_file_shares();

-- Retire the file credential even if an import later restores the old driver or team.
CREATE FUNCTION vch_remove_detached_file_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM agent_file_shares WHERE "storageNodeId" = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER remove_detached_file_share AFTER UPDATE OF driver, "teamId" ON "StorageNode"
FOR EACH ROW WHEN (ROW(NEW.driver, NEW."teamId") IS DISTINCT FROM ROW(OLD.driver, OLD."teamId"))
EXECUTE FUNCTION vch_remove_detached_file_share();
