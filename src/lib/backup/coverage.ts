/**
 * Which local file-storage directories a platform backup holds.
 *
 * A files or full backup archives fixed directories of the application
 * directory (scripts/backup.mjs). A full backup adds the directories named in
 * BACKUP_EXTRA_PATHS_JSON. The installer keeps file storage outside the
 * application directory (STORAGE_ROOT, /var/lib/<slug>/storage), so there a
 * "files" backup completes without one stored file in it, and a "full" one
 * holds them only when that directory is listed. The backup page says so.
 */

import path from "node:path";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { expandStorageBasePath } from "@/lib/storage/path-utils";

/** Directories of the application directory that a files or full backup archives (FILES_MODE_PATHS in scripts/backup.mjs). */
export const ARCHIVED_APP_DIRECTORIES = ["storage", "uploads", "downloads", "logs"] as const;

export type LocalStorageBackupCoverage = {
	/** Local storage directories no backup type holds. */
	uncovered: string[];
	/** Local storage directories only a full backup holds (BACKUP_EXTRA_PATHS_JSON). */
	fullOnly: string[];
};

function isWithin(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** The absolute paths in BACKUP_EXTRA_PATHS_JSON; anything else in it is not a path a backup would take. */
export function parseBackupExtraPaths(raw: string | undefined): string[] {
	if (!raw?.trim()) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string" && path.isAbsolute(entry)) : [];
	} catch {
		return [];
	}
}

export function classifyLocalStorageDirectories(input: { appDir: string; directories: string[]; extraPaths: string[] }): LocalStorageBackupCoverage {
	const appDir = path.resolve(input.appDir);
	const archived = ARCHIVED_APP_DIRECTORIES.map((name) => path.join(appDir, name));
	const extra = input.extraPaths.map((entry) => path.resolve(entry));
	const uncovered = new Set<string>();
	const fullOnly = new Set<string>();
	for (const directory of input.directories) {
		const resolved = path.resolve(appDir, directory);
		if (archived.some((member) => isWithin(member, resolved))) continue;
		if (extra.some((entry) => isWithin(entry, resolved))) fullOnly.add(resolved);
		else uncovered.add(resolved);
	}
	return { uncovered: [...uncovered].sort(), fullOnly: [...fullOnly].sort() };
}

/**
 * Coverage of this instance's local storage: every LOCAL storage node's
 * directory, and the root new customers' nodes are created under.
 */
export async function getLocalStorageBackupCoverage(): Promise<LocalStorageBackupCoverage> {
	const nodes = await prisma.storageNode.findMany({ where: { driver: "LOCAL" }, select: { basePath: true }, orderBy: { basePath: "asc" }, take: 1000 });
	const storageRoot = process.env.STORAGE_ROOT?.trim();
	const directories = [...nodes.map((node) => node.basePath), ...(storageRoot ? [storageRoot] : [])].map(expandStorageBasePath);
	const result = classifyLocalStorageDirectories({
		appDir: config.app.appDir || process.cwd(),
		directories,
		extraPaths: parseBackupExtraPaths(process.env.BACKUP_EXTRA_PATHS_JSON),
	});
	// A node below another listed directory is named by that directory.
	const outermost = (list: string[]) => list.filter((directory) => !list.some((other) => other !== directory && isWithin(other, directory)));
	return { uncovered: outermost(result.uncovered), fullOnly: outermost(result.fullOnly) };
}
