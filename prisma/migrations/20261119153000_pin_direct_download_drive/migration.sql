ALTER TABLE download_tasks ADD COLUMN "directStorageNodeId" TEXT;
ALTER TABLE download_tasks ADD CONSTRAINT download_tasks_one_destination
  CHECK ("agentStorageNodeId" IS NULL OR "directStorageNodeId" IS NULL);
