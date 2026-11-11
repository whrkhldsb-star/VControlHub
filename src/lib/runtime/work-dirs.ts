/**
 * Directories for bulky working files: upload staging and the thumbnail cache.
 *
 * Both used to default to `/tmp`, which is wrong twice under the shipped
 * systemd units:
 *
 *  - Every unit has `PrivateTmp=true`, so the web process and the worker each
 *    saw a `/tmp` of their own. The worker's sweeps (expired upload sessions,
 *    uploads kept for review, the thumbnail cache limit) cleaned an empty
 *    directory, while the web process's only grew until the next restart
 *    discarded it together with the chunks of every upload that could have
 *    been resumed.
 *  - Where `/tmp` is a tmpfs (Debian 13 and others) every staged byte is
 *    memory, charged to the web service and its `MemoryMax=768M`. Two 200 MB
 *    uploads at once (chunks plus the assembled copy of one) stalled the site.
 *
 * The default is therefore a directory beside the installation's other data:
 * on disk, and writable by all of its processes (the units list the data
 * directory in `ReadWritePaths`). `/tmp` remains the fallback where that
 * directory cannot be used: a development checkout, a container without the
 * data volume. An explicit setting always wins.
 */
import { accessSync, constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { config } from "@/lib/config/env";

import { defaultDataRoot, tempRoot } from "./platform-paths";

const decided = new Map<string, string>();

/**
 * The directory this installation keeps its data in, read off the file
 * history's: the installer always names that one (`/var/lib/<slug>/file-versions`),
 * and without a setting the application's own default sits in the same place.
 */
function dataRoot(): string | null {
	const fileVersions = config.fileVersion.dir || path.join(defaultDataRoot(), "file-versions");
	return path.isAbsolute(fileVersions) ? path.dirname(fileVersions) : null;
}

function usable(directory: string): boolean {
	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Decided once per process: the answer must not change under an upload in progress. */
function workDir(name: string, configured: string | undefined, fallback: string): string {
	if (configured) return configured;
	let directory = decided.get(name);
	if (!directory) {
		const root = dataRoot();
		const preferred = root ? path.join(root, name) : null;
		directory = preferred && usable(preferred) ? preferred : fallback;
		decided.set(name, directory);
	}
	return directory;
}

/** Chunks and assembled copies of uploads between their first byte and their finalization (`MEDIA_UPLOAD_TMP_DIR`). */
export function uploadTmpDir(): string {
	return workDir("upload-tmp", config.media.uploadTmpDir, path.join(tempRoot(), "vcontrolhub-media-uploads"));
}

/** Generated thumbnails; disposable, a miss regenerates (`MEDIA_THUMB_CACHE_DIR`). */
export function thumbnailCacheDir(): string {
	return workDir("thumbnails", config.media.thumbCacheDir, path.join(os.tmpdir(), "vcontrolhub-thumbnails"));
}
