/**
 * Storage node health — lazy background probe (TR-049).
 *
 * `checkStorageNodeHealth()` in `./service-nodes` already does the actual
 * probe work (LOCAL: stat the base path; SFTP: list the remote base path;
 * both write the result back to Prisma). What's missing is something to
 * actually *invoke* it on a regular basis — the user only gets fresh data
 * if they click the per-node button on `/storage`.
 *
 * The status page (`/api/status`) is a natural trigger: it's polled by
 * the ops dashboard and shows the user "已配置 N 个存储节点，K 个待探测"
 * as long as no probe has run. When that request sees any node whose
 * `lastHealthCheckAt` is null or stale, we fire a background probe from
 * the request lifecycle. Subsequent polls (1-5 s later) see fresh data.
 *
 * Design mirrors `scheduleDirectGatewayExposureProbe()` in
 * `src/lib/server/direct-gateway-probe.ts:152`:
 *   - Fire-and-forget: the caller does not await the result.
 *   - `setImmediate` pushes the work to the next event loop tick so the
 *     status response is not blocked on the (potentially slow) SSH round
 *     trip that an SFTP probe requires.
 *   - Every failure is logged; the function never throws.
 */

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

import { checkStorageNodeHealth } from "./service-nodes";

const log = createLogger("storage:health");

/** A node is considered "stale" if its last health check is older than
 *  this, or if it has never been checked, or if it was UNKNOWN. Five
 *  minutes is the sweet spot between "probe every request" (too noisy)
 *  and "probe once an hour" (storage hosts flap too slowly for ops to
 *  notice). Tweak via env if you need a different cadence. */
export const STORAGE_PROBE_STALE_MS = 5 * 60 * 1000;

const PROBE_BATCH_LIMIT = 50;

/**
 * Schedule a one-shot lazy probe of all stale storage nodes. Returns
 * immediately. Errors are logged and swallowed — this is best-effort
 * maintenance work that must never throw out of a status handler.
 */
export function scheduleStorageNodeHealthProbe(): void {
	setImmediate(() => {
		void probeAllStaleStorageNodes().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			log.error("storage lazy probe unhandled error", {
				error: message.slice(0, 200),
			});
		});
	});
}

export async function probeAllStaleStorageNodes(): Promise<{
	scanned: number;
	probed: number;
}> {
	const cutoff = new Date(Date.now() - STORAGE_PROBE_STALE_MS);
	const candidates = await prisma.storageNode.findMany({
		select: { id: true },
		where: {
			OR: [
				{ lastHealthCheckAt: null },
				{ lastHealthCheckAt: { lt: cutoff } },
				{ healthStatus: "UNKNOWN" },
			],
		},
		take: PROBE_BATCH_LIMIT,
	});
	if (candidates.length === 0) {
		return { scanned: 0, probed: 0 };
	}
	log.info("storage lazy probe start", { count: candidates.length });
	// Fan out — `checkStorageNodeHealth` is already self-contained (it
	// looks up the node, runs the driver-specific check, and writes
	// healthStatus/lastHealthCheckAt/lastHealthError back to Prisma).
	// We don't want to `await` every one: a slow SFTP host shouldn't
	// hold up the others, and we don't want to block the test runner on
	// a long-running probe when the test only cares that the schedule
	// function kicked the work off.
	await Promise.allSettled(
		candidates.map((node) =>
			checkStorageNodeHealth(node.id).catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				log.warn("storage node probe failed", {
					id: node.id,
					error: message.slice(0, 200),
				});
			}),
		),
	);
	return { scanned: candidates.length, probed: candidates.length };
}
