/**
 * PostgreSQL session-level advisory locks backed by a dedicated pg client.
 *
 * Session locks MUST be acquired and released on the same backend connection.
 * Prisma's pooled $executeRaw calls do not guarantee that property, so each
 * lock holds a PoolClient until its release callback completes.
 */
import { Pool, type PoolClient } from "pg";

import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("advisory-lock");

type AdvisoryLockGlobal = typeof globalThis & {
  __vcontrolhubAdvisoryLockPool?: Pool;
};

export function hashToInt32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const NAMESPACE_KEYS: Record<string, number> = {
  "backup-restore": 45057,
  "vps-backup-schedule": 45058,
  deployment: 45059,
  "ticket-escalation": 45060,
  /** Serialize ticket SLA sweep job enqueue (single-flight). */
  "ticket-sla-enqueue": 45068,
  /** Serialize quick-service lifecycle job enqueue per slug+instance. */
  "quick-service-enqueue": 45069,
  "playbook-execute": 45061,
  /** Serialize Compose project lifecycle mutations (up/down/start/stop/restart). */
  "docker-compose": 45062,
  /** Serialize destructive server profile deletion (gateway cleanup + cascades). */
  "server-delete": 45063,
  "sync-schedule": 45064,
  /** Serialize playbook run creation against destructive playbook deletion. */
  "playbook-lifecycle": 45065,
  /** Serialize builtin command template seed. */
  "command-template-seed": 45066,
  /** Serialize concurrent deployment rollback for one source run. */
  "deployment-rollback": 45067,
  /** Serialize server profile create/update by host to prevent duplicate VPS rows. */
  "server-host": 45070,
  /** Serialize quick-service host port allocation per docker target (hub-host or serverId). */
  "quick-service-port-alloc": 45071,
  /** Serialize storage grant quota checks (check usage then commit FileEntry). */
  "storage-quota": 45072,
  /** Serialize editable file read/check/snapshot/write/index operations. */
  "storage-editable": 45073,
  "storage-file-operation": 45086,
  /** Serialize membership mutations that enforce team-owner invariants. */
  "team-membership": 45074,
  /** Serialize singleton alert evaluation job enqueue. */
  "alert-evaluate-enqueue": 45075,
  /** Serialize singleton AI ops scan job enqueue. */
  "ai-ops-scan-enqueue": 45076,
  /** Serialize singleton operation-task retention job enqueue. */
  "operation-task-retention-enqueue": 45077,
  /** Serialize singleton cost snapshot job enqueue. */
  "cost-snapshot-enqueue": 45078,
  /** Serialize fleet health sampling job enqueue. */
  "health-sample-enqueue": 45079,
  /** Serialize traffic sampling job enqueue. */
  "traffic-sample-enqueue": 45080,
  /** Serialize singleton scheduled-command tick enqueue. */
  "scheduled-task-enqueue": 45081,
  /** Serialize singleton backup-schedule tick enqueue. */
  "backup-schedule-enqueue": 45082,
  /** Serialize idempotent inbound ITSM webhook side effects per external event. */
  "itsm-inbound": 45083,
  /** Serialize cloud billing import per account+month (concurrent upserts collide). */
  "cloud-billing-sync": 45084,
  /** Serialize moving a user's default AI provider (exactly one default). */
  "ai-provider-default": 45089,
  /** Serialize moving a customer's default storage node (exactly one default). */
  "storage-node-default": 45090,
};

function connectionStringForPg() {
  const url = new URL(config.db.url);
  // Prisma adapter-only tuning parameters are not PostgreSQL startup options.
  url.searchParams.delete("pool_max");
  url.searchParams.delete("pool_idle_timeout");
  url.searchParams.delete("connection_limit");
  return url.toString();
}

function getLockPool() {
  const globalState = globalThis as AdvisoryLockGlobal;
  globalState.__vcontrolhubAdvisoryLockPool ??= createLockPool();
  return globalState.__vcontrolhubAdvisoryLockPool;
}

function createLockPool() {
  const pool = new Pool({
    connectionString: connectionStringForPg(),
    max: Math.max(2, Math.min(config.db.poolSize, 4)),
    idleTimeoutMillis: config.db.poolIdleTimeoutMs,
    // The pg default is to wait forever for a pool slot. Each advisory lock
    // pins a dedicated client for its whole critical section, so >max
    // concurrent lock holders must fail fast instead of queueing without
    // bound (request pile-up under a burst).
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  // When the backend of an idle client goes away (a PostgreSQL restart sends
  // 57P01 to every session; unattended upgrades do that), the pool drops the
  // client and re-emits the error. An 'error' event without a listener is
  // thrown, which took the worker process down on 2026-10-09 and 2026-10-15.
  pool.on("error", (error) => {
    logger.warn("advisory lock pool dropped an idle connection", { error: error.message });
  });
  return pool;
}

/**
 * Check out a dedicated client. The pool only listens for errors while a
 * client is idle, so a checked-out one needs its own listener: a connection
 * lost while a lock is held (or being acquired) would otherwise be thrown
 * from the socket and crash the process. PostgreSQL ends the session lock
 * with the session, so the holder is no longer exclusive; say so.
 */
async function connectLockClient(namespace: string, resourceId: string) {
  const client = await getLockPool().connect();
  const onError = (error: Error) => {
    logger.error("advisory lock connection lost; the lock is no longer held", {
      namespace,
      resourceId,
      error: error.message,
    });
  };
  client.on("error", onError);
  const giveBack = (error?: Error) => {
    client.removeListener("error", onError);
    // With an error the pool closes the client instead of reusing it.
    client.release(error);
  };
  return { client, giveBack };
}

async function releaseClientLock(
  client: PoolClient,
  giveBack: (error?: Error) => void,
  k1: number,
  k2: number,
  namespace: string,
  resourceId: string,
) {
  let failure: Error | undefined;
  try {
    const result = await client.query<{ unlocked: boolean }>(
      "SELECT pg_advisory_unlock($1, $2) AS unlocked",
      [k1, k2],
    );
    if (result.rows[0]?.unlocked !== true)
      logger.warn("advisory lock was not held by its dedicated session", {
        namespace,
        resourceId,
        k1,
        k2,
      });
    else logger.debug("advisory lock released", { namespace, resourceId });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    logger.error("failed to release advisory lock", {
      namespace,
      resourceId,
      error: failure.message,
    });
  } finally {
    // A failed unlock may leave the lock held by this session: close the
    // session (which ends the lock) rather than pool it with the lock held.
    giveBack(failure);
  }
}

function buildRelease(
  client: PoolClient,
  giveBack: (error?: Error) => void,
  k1: number,
  k2: number,
  namespace: string,
  resourceId: string,
) {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await releaseClientLock(client, giveBack, k1, k2, namespace, resourceId);
  };
}

/** Cap blocking wait so a hung holder cannot pin the tiny advisory-lock pool forever. */
const ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;

export async function acquireAdvisoryLock(
  namespace: string,
  resourceId: string,
): Promise<() => Promise<void>> {
  const { k1, k2 } = getLockKeys(namespace, resourceId);
  const { client, giveBack } = await connectLockClient(namespace, resourceId);
  try {
    // A session setting: it stays on this pooled connection, which only
    // ever serves advisory locks, and every blocking acquire sets it.
    await client.query(
      `SET lock_timeout = ${ADVISORY_LOCK_ACQUIRE_TIMEOUT_MS}`,
    );
    await client.query("SELECT pg_advisory_lock($1, $2)", [k1, k2]);
    logger.debug("advisory lock acquired", { namespace, resourceId, k1, k2 });
    return buildRelease(client, giveBack, k1, k2, namespace, resourceId);
  } catch (error) {
    giveBack();
    throw error;
  }
}

export async function tryAcquireAdvisoryLock(
  namespace: string,
  resourceId: string,
): Promise<(() => Promise<void>) | null> {
  const { k1, k2 } = getLockKeys(namespace, resourceId);
  const { client, giveBack } = await connectLockClient(namespace, resourceId);
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [k1, k2],
    );
    if (result.rows[0]?.acquired !== true) {
      giveBack();
      logger.debug("advisory lock busy", { namespace, resourceId });
      return null;
    }
    logger.debug("advisory lock acquired (non-blocking)", {
      namespace,
      resourceId,
      k1,
      k2,
    });
    return buildRelease(client, giveBack, k1, k2, namespace, resourceId);
  } catch (error) {
    giveBack();
    throw error;
  }
}

export function getLockKeys(
  namespace: string,
  resourceId: string,
): { k1: number; k2: number } {
  return {
    k1: NAMESPACE_KEYS[namespace] ?? hashToInt32(namespace),
    k2: hashToInt32(resourceId),
  };
}

type RawExecutor = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>;
};

/**
 * Transaction-scoped advisory lock, taken on the transaction's own
 * connection and released when it commits or rolls back. Use it inside
 * `prisma.$transaction(async (tx) => …)` to serialize a read-modify-write
 * that row locks cannot cover (rows that do not exist yet).
 */
export async function lockForTransaction(tx: RawExecutor, namespace: string, resourceId: string) {
  const { k1, k2 } = getLockKeys(namespace, resourceId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`;
}

export async function closeAdvisoryLockPoolForTests() {
  const globalState = globalThis as AdvisoryLockGlobal;
  const pool = globalState.__vcontrolhubAdvisoryLockPool;
  delete globalState.__vcontrolhubAdvisoryLockPool;
  if (pool) await pool.end();
}
