/**
 * FEAT-ARCH-P1-2: Unified advisory lock service.
 *
 * Replaces scattered `pg_advisory_lock` calls with a single, typed service
 * that generates stable lock keys from a namespace + resource ID.
 *
 * Usage:
 *   const release = await acquireAdvisoryLock("backup-restore", backupId);
 *   try { ... } finally { await release(); }
 */

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("advisory-lock");

/**
 * Hash a string into a stable int32. Used to derive lock keys from
 * arbitrary resource IDs (cuid, uuid, etc.) without collision.
 */
export function hashToInt32(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
	}
	return h;
}

/** Well-known namespace → fixed key1, preventing key collisions across domains. */
const NAMESPACE_KEYS: Record<string, number> = {
	"backup-restore": 45057,
	"vps-backup-schedule": 45058,
	"deployment": 45059,
	"ticket-escalation": 45060,
	"playbook-execute": 45061,
};

/**
 * Acquire a PostgreSQL session-level advisory lock.
 *
 * @param namespace  Logical domain (e.g. "backup-restore")
 * @param resourceId  Resource identifier (e.g. backup record ID)
 * @returns A release function. Call it in a finally block.
 */
export async function acquireAdvisoryLock(
	namespace: string,
	resourceId: string,
): Promise<() => Promise<void>> {
	const k1 = NAMESPACE_KEYS[namespace] ?? hashToInt32(namespace);
	const k2 = hashToInt32(resourceId);

	await prisma.$executeRaw`SELECT pg_advisory_lock(${k1}, ${k2})`;
	logger.debug("advisory lock acquired", { namespace, resourceId, k1, k2 });

	return async () => {
		try {
			await prisma.$executeRaw`SELECT pg_advisory_unlock(${k1}, ${k2})`;
			logger.debug("advisory lock released", { namespace, resourceId });
		} catch (err) {
			logger.warn("failed to release advisory lock", { namespace, resourceId, error: String(err) });
		}
	};
}

/**
 * Try to acquire an advisory lock without blocking. Returns null if the
 * lock is already held by another session.
 *
 * @returns A release function, or null if the lock was not acquired.
 */
export async function tryAcquireAdvisoryLock(
	namespace: string,
	resourceId: string,
): Promise<(() => Promise<void>) | null> {
	const k1 = NAMESPACE_KEYS[namespace] ?? hashToInt32(namespace);
	const k2 = hashToInt32(resourceId);

	const result = await prisma.$queryRaw<{ pg_try_advisory_lock: boolean }[]>`
		SELECT pg_try_advisory_lock(${k1}, ${k2}) as pg_try_advisory_lock
	`;
	const acquired = result[0]?.pg_try_advisory_lock === true;

	if (!acquired) {
		logger.debug("advisory lock busy", { namespace, resourceId });
		return null;
	}

	logger.debug("advisory lock acquired (non-blocking)", { namespace, resourceId, k1, k2 });
	return async () => {
		try {
			await prisma.$executeRaw`SELECT pg_advisory_unlock(${k1}, ${k2})`;
		} catch (err) {
			logger.warn("failed to release advisory lock", { namespace, resourceId, error: String(err) });
		}
	};
}

/**
 * Generate a stable (k1, k2) pair for a given namespace + resource.
 * Useful for testing and debugging.
 */
export function getLockKeys(namespace: string, resourceId: string): { k1: number; k2: number } {
	return {
		k1: NAMESPACE_KEYS[namespace] ?? hashToInt32(namespace),
		k2: hashToInt32(resourceId),
	};
}
