DELETE FROM agent_file_shares sh USING servers s, "StorageNode" n
WHERE sh."serverId" = s.id AND sh."storageNodeId" = n.id
AND s."teamId" IS DISTINCT FROM n."teamId";

ALTER TABLE file_entries ADD COLUMN "storageVersion" TEXT;
ALTER TABLE download_tasks ADD COLUMN "agentStorageNodeId" TEXT;
