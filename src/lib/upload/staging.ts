/**
 * What is left in the upload staging directory with nobody to come back for it.
 *
 * While staging was a systemd unit's private `/tmp`, a restart discarded all
 * of it. On disk (see `@/lib/runtime/work-dirs`) nothing does, so what the
 * ordinary paths do not remove is removed here, from the maintenance worker:
 *
 *  - the directory of a session whose row is gone (retention deleted it), or
 *    that ended COMPLETED or CANCELLED while its own cleanup failed;
 *  - the temp file of a WebDAV PUT whose process ended mid-request.
 *
 * Kept: a session still receiving chunks or being finalized, and every FAILED
 * one. An upload awaiting review keeps its bytes as recovery material until an
 * administrator resolves it; its directory then goes with its row.
 */
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db";
import { uploadTmpDir } from "@/lib/runtime/work-dirs";

/** Name prefix of a WebDAV PUT body while it is being received (`<prefix><uuid>.tmp`). */
export const WEBDAV_PUT_STAGING_PREFIX = "webdav-put-";

/** A directory younger than this may belong to a session that is being created right now. */
const ORPHAN_DIRECTORY_GRACE_MS = 60 * 60 * 1000;
/** A PUT that is still being received touches its file with every write. */
const STALE_PUT_MS = 24 * 60 * 60 * 1000;
const SESSION_LOOKUP_BATCH = 500;
/** A session id (cuid). MEDIA_UPLOAD_TMP_DIR may name a directory other things live in: those are not ours to judge. */
const SESSION_ID = /^c[a-z0-9]{20,40}$/;
const REMOVABLE_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

export async function sweepOrphanedUploadStaging(now = Date.now()): Promise<{ directories: number; files: number }> {
	const root = uploadTmpDir();
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const oldSessionDirectories: string[] = [];
	let files = 0;
	for (const entry of entries) {
		const target = path.join(root, entry.name);
		const age = await stat(target).then((info) => now - info.mtimeMs, () => null);
		if (age === null) continue;
		if (entry.isDirectory()) {
			if (SESSION_ID.test(entry.name) && age >= ORPHAN_DIRECTORY_GRACE_MS) oldSessionDirectories.push(entry.name);
		} else if (entry.isFile() && entry.name.startsWith(WEBDAV_PUT_STAGING_PREFIX) && entry.name.endsWith(".tmp") && age >= STALE_PUT_MS) {
			if (await rm(target, { force: true }).then(() => true, () => false)) files += 1;
		}
	}

	let directories = 0;
	for (let start = 0; start < oldSessionDirectories.length; start += SESSION_LOOKUP_BATCH) {
		const ids = oldSessionDirectories.slice(start, start + SESSION_LOOKUP_BATCH);
		const rows = await prisma.mediaUploadSession.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
		const statusOf = new Map(rows.map((row) => [row.id, row.status as string]));
		for (const id of ids) {
			const status = statusOf.get(id);
			if (status !== undefined && !REMOVABLE_STATUSES.has(status)) continue;
			if (await rm(path.join(root, id), { recursive: true, force: true }).then(() => true, () => false)) directories += 1;
		}
	}
	return { directories, files };
}
