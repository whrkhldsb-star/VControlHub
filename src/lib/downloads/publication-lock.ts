import { Client } from "pg";
import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";
import { storagePathLockIds } from "@/lib/storage/file-overwrite-lock";

const logger = createLogger("download-publication");

export type PublicationLock = (() => Promise<void>) & {
  signal: AbortSignal;
  assertHeld: () => void;
};

/** A publication holds one connection, independent of the pool serving its authorization and index queries. */
export async function lockDownloadPublication(nodeId: string, relative: string): Promise<PublicationLock> {
  const url = new URL(config.db.url);
  for (const option of ["pool_max", "pool_idle_timeout", "connection_limit"]) url.searchParams.delete(option);
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  const lossController = new AbortController();
  let released = false;
  const markLost = (reason: string) => {
    if (released || lossController.signal.aborted) return;
    lossController.abort(new Error(`Publication lock connection lost: ${reason}`));
  };
  client.on("error", error => {
    logger.error("Publication lock connection lost", { nodeId, error: error.message });
    markLost(error.message);
  });
  client.on("end", () => {
    if (!released) {
      logger.error("Publication lock connection ended unexpectedly", { nodeId });
      markLost("connection ended");
    }
  });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '30s'");
    const quota = getLockKeys("storage-quota", nodeId);
    await client.query("SELECT pg_advisory_lock($1, $2)", [quota.k1, quota.k2]);
    const ids = storagePathLockIds(nodeId, relative);
    const file = getLockKeys("storage-editable", ids.resourceId);
    const keys = new Set([file.k2, ...ids.sharedResourceIds.map(id => getLockKeys("storage-editable", id).k2)]);
    for (const key of [...keys].sort((a, b) => a - b)) {
      await client.query(key === file.k2 ? "SELECT pg_advisory_lock($1, $2)" : "SELECT pg_advisory_lock_shared($1, $2)", [file.k1, key]);
    }
    const assertHeld = () => {
      if (lossController.signal.aborted) {
        const reason = lossController.signal.reason;
        throw reason instanceof Error ? reason : new Error("Publication lock lost");
      }
    };
    const release = Object.assign(
      async () => {
        released = true;
        await client.end();
      },
      { signal: lossController.signal, assertHeld },
    );
    return release;
  } catch (error) {
    released = true;
    await client.end();
    throw error;
  }
}
