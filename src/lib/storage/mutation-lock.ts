import { Pool } from "pg";
import { config } from "@/lib/config/env";
import { AdvisoryLockBusyError, getLockKeys } from "@/lib/concurrency/advisory-lock";
import { createLogger } from "@/lib/logging";
import { storagePathLockIds } from "./file-overwrite-lock";

let pool: Pool | undefined;
function storageMutationPool() {
  if (pool) return pool;
  const url = new URL(config.db.url);
  for (const option of ["pool_max", "pool_idle_timeout", "connection_limit"]) url.searchParams.delete(option);
  pool = new Pool({ connectionString: url.href, max: Math.max(1, Math.min(4, config.db.poolSize)),
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: config.db.poolIdleTimeoutMs, allowExitOnIdle: true });
  pool.on("error", error => createLogger("storage:mutation").warn("Storage lock connection lost", { error }));
  return pool;
}

/** All locks are transaction-scoped on one dedicated session, separate from metadata queries. */
async function lockStorageMutation(nodeId: string, destination: string, moveSource?: string) {
  const client = await storageMutationPool().connect();
  let failed: Error | undefined;
  const lost = (error: Error) => { failed = error; };
  client.on("error", lost);
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await client.query("ROLLBACK"); }
    catch (error) { failed = error as Error; }
    finally { client.off("error", lost); client.release(failed); }
  };
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '30s'");
    if (moveSource !== undefined) {
      const operation = getLockKeys("storage-file-operation", nodeId);
      const { rows } = await client.query("SELECT pg_try_advisory_xact_lock($1, $2) AS acquired", [operation.k1, operation.k2]);
      if (!rows[0].acquired) throw new AdvisoryLockBusyError("storage-file-operation", "held", null);
    }
    const quota = getLockKeys("storage-quota", nodeId);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [quota.k1, quota.k2]);
    const paths = storagePathLockIds(nodeId, destination, moveSource);
    const key = (id: string) => getLockKeys("storage-editable", id).k2;
    const namespace = getLockKeys("storage-editable", paths.resourceId).k1;
    const exclusive = new Set([key(paths.resourceId)]);
    if (paths.additionalResourceId !== undefined) exclusive.add(key(paths.additionalResourceId));
    const keys = new Set([...exclusive, ...paths.sharedResourceIds.map(key)]);
    for (const path of [...keys].sort((a, b) => a - b)) {
      await client.query(exclusive.has(path) ? "SELECT pg_advisory_xact_lock($1, $2)" : "SELECT pg_advisory_xact_lock_shared($1, $2)", [namespace, path]);
    }
    return { nodeId, release };
  } catch (error) {
    await release();
    if ((error as { code?: string }).code === "55P03") throw new AdvisoryLockBusyError("storage-editable", "held", error);
    throw error;
  }
}

export function lockStorageMove(nodeId: string, source: string, destination: string) {
  return lockStorageMutation(nodeId, destination, source);
}

/** Copy and restore already hold the node operation lock. Take their quota and path locks together. */
export function lockStorageWrite(nodeId: string, destination: string) {
  return lockStorageMutation(nodeId, destination);
}
