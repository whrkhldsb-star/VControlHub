/**
 * Platform restore gate: lets background workers see that a restore is in
 * progress, without storing that fact in the database being restored.
 *
 * restoreBackupRecord holds a session advisory lock ("backup-restore",
 * "platform") for its whole run. Any process can see that lock in pg_locks —
 * across app instances and across the restore's own DROP/CREATE of every
 * table — so a flag row is not needed (and would itself be overwritten by the
 * restore). Job claiming and sync execution consult this before starting new
 * work; the restore drains the work already running before it touches data.
 */
import { prisma } from "@/lib/db";
import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { createLogger } from "@/lib/logging";

const logger = createLogger("restore-gate");

export const PLATFORM_RESTORE_LOCK = { namespace: "backup-restore", resourceId: "platform" } as const;

type RawQueryClient = Pick<typeof prisma, "$queryRaw">;

/**
 * True while a platform restore holds its lock. Fails open (false) when the
 * probe itself errors: a database that cannot answer pg_locks cannot run the
 * work this gate protects either, and a gate that throws would take every
 * worker down with it.
 */
export async function isPlatformRestoreInProgress(client: RawQueryClient = prisma): Promise<boolean> {
	const { k1, k2 } = getLockKeys(PLATFORM_RESTORE_LOCK.namespace, PLATFORM_RESTORE_LOCK.resourceId);
	try {
		// Two-key advisory locks appear with classid=key1, objid=key2,
		// objsubid=2; the oid columns hold the keys as unsigned 32-bit values.
		const rows = await client.$queryRaw<Array<{ held: boolean }>>`
			SELECT EXISTS (
				SELECT 1 FROM pg_locks
				WHERE locktype = 'advisory'
					AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
					AND classid = ${k1 >>> 0}::bigint::oid
					AND objid = ${k2 >>> 0}::bigint::oid
					AND objsubid = 2
					AND granted
			) AS held
		`;
		return Array.isArray(rows) && rows[0]?.held === true;
	} catch (error) {
		logger.debug("restore gate probe failed; treating as no restore in progress", {
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}
