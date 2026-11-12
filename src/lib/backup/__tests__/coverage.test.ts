// @vitest-environment node
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { storageNode: { findMany } } }));

import { classifyLocalStorageDirectories, getLocalStorageBackupCoverage, parseBackupExtraPaths } from "../coverage";

/**
 * The installer keeps file storage in /var/lib/<slug>/storage, outside the
 * application directory whose storage/, uploads/, downloads/ and logs/ a files
 * or full backup archives: such a backup completed without one stored file.
 */
describe.skipIf(process.platform === "win32")("which local storage directories a platform backup holds", () => {
	const appDir = "/opt/VControlHub";

	it("counts a directory under the archived application directories as held", () => {
		expect(classifyLocalStorageDirectories({ appDir, directories: ["/opt/VControlHub/storage/teams/t1", "storage/teams/t2", "/opt/VControlHub/storage"], extraPaths: [] }))
			.toEqual({ uncovered: [], fullOnly: [] });
	});

	it("reports the installer's storage root as held by no backup, and by a full one once it is listed", () => {
		const directories = ["/var/lib/vcontrolhub/storage/teams/t1", "/var/lib/vcontrolhub/storage"];
		expect(classifyLocalStorageDirectories({ appDir, directories, extraPaths: [] }))
			.toEqual({ uncovered: ["/var/lib/vcontrolhub/storage", "/var/lib/vcontrolhub/storage/teams/t1"], fullOnly: [] });
		expect(classifyLocalStorageDirectories({ appDir, directories, extraPaths: ["/var/lib/vcontrolhub/storage"] }))
			.toEqual({ uncovered: [], fullOnly: ["/var/lib/vcontrolhub/storage", "/var/lib/vcontrolhub/storage/teams/t1"] });
	});

	it("does not take a sibling whose name merely starts the same for an archived directory", () => {
		// /opt/VControlHub/storage-old is not inside /opt/VControlHub/storage.
		expect(classifyLocalStorageDirectories({ appDir, directories: ["/opt/VControlHub/storage-old", "/opt/VControlHub/data"], extraPaths: ["/opt/VControlHub/dat"] }).uncovered)
			.toEqual(["/opt/VControlHub/data", "/opt/VControlHub/storage-old"]);
	});

	it("reads BACKUP_EXTRA_PATHS_JSON as the backup does: a JSON array of absolute paths", () => {
		expect(parseBackupExtraPaths('["/var/lib/vcontrolhub/storage","relative/path",7]')).toEqual(["/var/lib/vcontrolhub/storage"]);
		expect(parseBackupExtraPaths(undefined)).toEqual([]);
		expect(parseBackupExtraPaths("not json")).toEqual([]);
		expect(parseBackupExtraPaths('"/var/lib/x"')).toEqual([]);
	});

	describe("for this instance", () => {
		beforeEach(() => {
			vi.unstubAllEnvs();
			vi.stubEnv("APP_DIR", appDir);
			vi.stubEnv("APP_SLUG", "vcontrolhub");
			findMany.mockReset();
		});

		it("names the storage root once, not every customer directory below it", async () => {
			vi.stubEnv("STORAGE_ROOT", "/var/lib/${APP_SLUG:-vcontrolhub}/storage");
			vi.stubEnv("BACKUP_EXTRA_PATHS_JSON", "");
			findMany.mockResolvedValue([{ basePath: "/var/lib/vcontrolhub/storage/teams/t1" }, { basePath: "/var/lib/vcontrolhub/storage/teams/t2" }, { basePath: "/srv/files" }]);
			expect(await getLocalStorageBackupCoverage()).toEqual({ uncovered: ["/srv/files", "/var/lib/vcontrolhub/storage"], fullOnly: [] });
			expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { driver: "LOCAL" } }));
		});

		it("has nothing to report where storage lives in the application directory (the container layout)", async () => {
			vi.stubEnv("STORAGE_ROOT", path.join(appDir, "storage"));
			findMany.mockResolvedValue([{ basePath: path.join(appDir, "storage", "teams", "t1") }]);
			expect(await getLocalStorageBackupCoverage()).toEqual({ uncovered: [], fullOnly: [] });
		});

		it("moves a listed directory to the full-backup-only group", async () => {
			vi.stubEnv("STORAGE_ROOT", "/var/lib/vcontrolhub/storage");
			vi.stubEnv("BACKUP_EXTRA_PATHS_JSON", '["/var/lib/vcontrolhub/storage"]');
			findMany.mockResolvedValue([{ basePath: "/var/lib/vcontrolhub/storage/teams/t1" }]);
			expect(await getLocalStorageBackupCoverage()).toEqual({ uncovered: [], fullOnly: ["/var/lib/vcontrolhub/storage"] });
		});
	});
});

describe("the directory list the page mirrors", () => {
	it("is the one scripts/backup.mjs archives for a files backup", async () => {
		const { readFile } = await import("node:fs/promises");
		const { ARCHIVED_APP_DIRECTORIES } = await import("../coverage");
		const script = await readFile(path.resolve("scripts/backup.mjs"), "utf8");
		const declared = /const FILES_MODE_PATHS = (\[[^\]]*\]);/.exec(script)?.[1];
		expect(declared && JSON.parse(declared)).toEqual([...ARCHIVED_APP_DIRECTORIES]);
	});
});
