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

type AdvisoryLockGlobal = typeof globalThis & { __vcontrolhubAdvisoryLockPool?: Pool };

export function hashToInt32(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
	return h;
}

const NAMESPACE_KEYS: Record<string, number> = {
	"backup-restore": 45057,
	"vps-backup-schedule": 45058,
	"deployment": 45059,
	"ticket-escalation": 45060,
	"playbook-execute": 45061,
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
	globalState.__vcontrolhubAdvisoryLockPool ??= new Pool({
		connectionString: connectionStringForPg(),
		max: Math.max(2, Math.min(config.db.poolSize, 4)),
		idleTimeoutMillis: config.db.poolIdleTimeoutMs,
		allowExitOnIdle: true,
	});
	return globalState.__vcontrolhubAdvisoryLockPool;
}

async function releaseClientLock(client: PoolClient, k1: number, k2: number, namespace: string, resourceId: string) {
	try {
		const result = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock($1, $2) AS unlocked", [k1, k2]);
		if (result.rows[0]?.unlocked !== true) logger.warn("advisory lock was not held by its dedicated session", { namespace, resourceId, k1, k2 });
		else logger.debug("advisory lock released", { namespace, resourceId });
	} catch (error) {
		logger.error("failed to release advisory lock", { namespace, resourceId, error: error instanceof Error ? error.message : String(error) });
	} finally {
		client.release();
	}
}

function buildRelease(client: PoolClient, k1: number, k2: number, namespace: string, resourceId: string) {
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		await releaseClientLock(client, k1, k2, namespace, resourceId);
	};
}

export async function acquireAdvisoryLock(namespace: string, resourceId: string): Promise<() => Promise<void>> {
	const { k1, k2 } = getLockKeys(namespace, resourceId);
	const client = await getLockPool().connect();
	try {
		await client.query("SELECT pg_advisory_lock($1, $2)", [k1, k2]);
		logger.debug("advisory lock acquired", { namespace, resourceId, k1, k2 });
		return buildRelease(client, k1, k2, namespace, resourceId);
	} catch (error) {
		client.release();
		throw error;
	}
}

export async function tryAcquireAdvisoryLock(namespace: string, resourceId: string): Promise<(() => Promise<void>) | null> {
	const { k1, k2 } = getLockKeys(namespace, resourceId);
	const client = await getLockPool().connect();
	try {
		const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS acquired", [k1, k2]);
		if (result.rows[0]?.acquired !== true) {
			client.release();
			logger.debug("advisory lock busy", { namespace, resourceId });
			return null;
		}
		logger.debug("advisory lock acquired (non-blocking)", { namespace, resourceId, k1, k2 });
		return buildRelease(client, k1, k2, namespace, resourceId);
	} catch (error) {
		client.release();
		throw error;
	}
}

export function getLockKeys(namespace: string, resourceId: string): { k1: number; k2: number } {
	return { k1: NAMESPACE_KEYS[namespace] ?? hashToInt32(namespace), k2: hashToInt32(resourceId) };
}

export async function closeAdvisoryLockPoolForTests() {
	const globalState = globalThis as AdvisoryLockGlobal;
	const pool = globalState.__vcontrolhubAdvisoryLockPool;
	delete globalState.__vcontrolhubAdvisoryLockPool;
	if (pool) await pool.end();
}
