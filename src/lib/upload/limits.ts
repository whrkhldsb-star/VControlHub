import { statfs } from "node:fs/promises";

import { config } from "@/lib/config/env";

/** Largest chunked storage upload, from STORAGE_UPLOAD_MAX_BYTES (default 2 GiB). */
export function getStorageUploadMaxBytes(): number {
	return config.storage.uploadMaxBytes;
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
