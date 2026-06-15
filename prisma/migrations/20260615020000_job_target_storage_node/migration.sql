-- TR-001 T13b: per-storage-node concurrency cap.
--
-- The Job model now carries an optional `targetStorageNodeId` so
-- `claimNextJob` can cheaply count in-flight jobs targeting a given
-- storage node (the previous design stored the node id inside the
-- JSON `payload`, which is unindexable). Existing rows get NULL
-- (= no per-node limit applies) and the new `@@index([targetStorageNodeId,
-- status])` keeps the count query sub-millisecond.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "targetStorageNodeId" TEXT;

CREATE INDEX IF NOT EXISTS "jobs_targetStorageNodeId_status_idx"
  ON "jobs"("targetStorageNodeId", "status");
