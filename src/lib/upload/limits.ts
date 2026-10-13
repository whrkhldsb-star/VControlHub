import { statfs } from "node:fs/promises";

import { getRuntimeSettingNumberCached } from "@/lib/runtime-settings/cached";

/**
 * Largest chunked storage upload: the `storage.uploadMaxBytes` setting, else
 * STORAGE_UPLOAD_MAX_BYTES, else 2 GiB. Sync callers (schema parsing) get the
 * per-process cached value, refreshed within a minute of a change.
 */
export function getStorageUploadMaxBytes(): number {
	return getRuntimeSettingNumberCached("storage.uploadMaxBytes");
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
