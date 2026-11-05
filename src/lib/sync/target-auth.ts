/**
 * How a sync job's source host logs in to the server it writes to.
 *
 *   - "credential": the original way. The target server's own private key, or
 *     its password (as SSHPASS), is written to the source host's /tmp for the
 *     run; root on the source can copy it while it is there.
 *   - "one-time-key": a key made on the hub for the run (`./one-time-key`),
 *     limited to the transfer and removed afterwards. The source never gets the
 *     target's credential, but the target must allow public-key login.
 *
 * Each server stores "credential", "one-time-key" or "inherit" (follow the
 * platform setting `sync.targetAuthDefault`, itself "credential" unless an
 * administrator changes it). Servers that existed before the choice was added
 * were set to "credential" by the migration, so changing the platform setting
 * never changes how they are synced.
 */
export type SyncTargetAuth = "credential" | "one-time-key";
export type ServerSyncTargetAuth = SyncTargetAuth | "inherit";

export const SYNC_TARGET_AUTH_SETTING = "sync.targetAuthDefault";
export const SERVER_SYNC_TARGET_AUTH_VALUES = ["inherit", "credential", "one-time-key"] as const;

export function isSyncTargetAuth(value: unknown): value is SyncTargetAuth {
	return value === "credential" || value === "one-time-key";
}

/** A stored per-server value; anything unknown (or absent) follows the platform setting. */
export function parseServerSyncTargetAuth(value: unknown): ServerSyncTargetAuth {
	return isSyncTargetAuth(value) ? value : "inherit";
}

/**
 * The mode for one server. `readDefault` is consulted only for a server that
 * follows the platform setting; a value it does not know is an error rather
 * than a quiet fallback, since the fallback would be the less safe mode.
 */
export async function resolveSyncTargetAuth(
	server: { syncTargetAuth?: string | null },
	readDefault: () => Promise<string>,
): Promise<SyncTargetAuth> {
	const own = parseServerSyncTargetAuth(server.syncTargetAuth);
	if (own !== "inherit") return own;
	const platform = (await readDefault()).trim() || "credential";
	if (!isSyncTargetAuth(platform)) {
		throw new Error(`The setting ${SYNC_TARGET_AUTH_SETTING} holds "${platform}"; it must be credential or one-time-key.`);
	}
	return platform;
}
