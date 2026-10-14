import { statfs } from "node:fs/promises";

import { getRuntimeSettingNumberCached } from "@/lib/runtime-settings/cached";
import { getRuntimeSettingFallback, readPersistedRuntimeSettingNumberStrict } from "@/lib/runtime-settings/service";

/**
 * Largest chunked storage upload: the `storage.uploadMaxBytes` setting, else
 * STORAGE_UPLOAD_MAX_BYTES, else 2 GiB. Sync callers (schema parsing) get the
 * per-process cached value, refreshed within a minute of a change.
 */
export function getStorageUploadMaxBytes(): number {
	return getRuntimeSettingNumberCached("storage.uploadMaxBytes");
}

/**
 * The same limit read from the database at the moment of admission. The
 * places that actually accept or assemble an upload use this, so a lowered
 * limit applies even in a process whose cache is still cold; a database error
 * fails the upload rather than falling back to a larger env/default limit.
 */
export async function readStorageUploadMaxBytes(): Promise<number> {
	const persisted = await readPersistedRuntimeSettingNumberStrict("storage.uploadMaxBytes");
	return persisted ?? getRuntimeSettingFallback("storage.uploadMaxBytes");
}

/** Kept free on the upload temp volume after admitting an upload. */
export const UPLOAD_DISK_RESERVE_BYTES = 512 * 1024 * 1024;

/**
 * Free bytes a new upload of `totalSize` needs on the temp volume: its chunks
 * plus the assembled file (both live there until finalize) plus a reserve so
 * an upload cannot fill the disk the database and logs share.
 */
export function requiredUploadHeadroom(totalSize: number): number {
	return totalSize * 2 + UPLOAD_DISK_RESERVE_BYTES;
}

/** Returns the free bytes on `dir`'s volume, or null when it cannot be read. */
export async function freeBytesOn(dir: string): Promise<number | null> {
	try {
		const stats = await statfs(dir);
		return Number(stats.bavail) * Number(stats.bsize);
	} catch {
		return null;
	}
}
