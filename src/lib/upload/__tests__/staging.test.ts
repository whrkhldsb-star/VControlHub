// @vitest-environment node
import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "", findMany: vi.fn() }));

vi.mock("@/lib/runtime/work-dirs", () => ({ uploadTmpDir: () => mocks.root }));
vi.mock("@/lib/db", () => ({ prisma: { mediaUploadSession: { findMany: mocks.findMany } } }));

import { sweepOrphanedUploadStaging, WEBDAV_PUT_STAGING_PREFIX } from "../staging";

const HOUR = 60 * 60 * 1000;
const now = Date.now();
/** Session ids as the database mints them. */
const id = (name: string) => `c${name.padEnd(24, "0")}`;

async function aged(target: string, ageMs: number) {
	const when = new Date(now - ageMs);
	await utimes(target, when, when);
}

async function sessionDir(name: string, ageMs: number) {
	const dir = path.join(mocks.root, id(name));
	await mkdir(dir);
	await writeFile(path.join(dir, "chunk-0"), "bytes");
	await aged(dir, ageMs);
	return id(name);
}

async function stagedPut(name: string, ageMs: number) {
	const file = path.join(mocks.root, name);
	await writeFile(file, "bytes");
	await aged(file, ageMs);
}

function rows(statuses: Record<string, string>) {
	mocks.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
		where.id.in.filter((wanted) => wanted in statuses).map((wanted) => ({ id: wanted, status: statuses[wanted] })));
}

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.root = await mkdtemp(path.join(os.tmpdir(), "vch-staging-"));
	rows({});
});

// While staging was a unit's private /tmp a restart discarded everything in it. On disk nothing does.
describe("what nobody comes back for in the upload staging directory", () => {
	it("removes the directory of a session whose row is gone, once it is old enough to be nobody's", async () => {
		const gone = await sessionDir("gone", 2 * HOUR);
		const justMade = await sessionDir("justmade", 5 * 60 * 1000);

		const result = await sweepOrphanedUploadStaging(now);

		expect(result).toEqual({ directories: 1, files: 0 });
		expect(await readdir(mocks.root)).toEqual([justMade]);
		expect(mocks.findMany).toHaveBeenCalledWith({ where: { id: { in: [gone] } }, select: { id: true, status: true } });
	});

	it("removes what a finished or cancelled session left when its own cleanup failed", async () => {
		const completed = await sessionDir("completed", 3 * HOUR);
		const cancelled = await sessionDir("cancelled", 3 * HOUR);
		rows({ [completed]: "COMPLETED", [cancelled]: "CANCELLED" });

		expect(await sweepOrphanedUploadStaging(now)).toEqual({ directories: 2, files: 0 });
		expect(await readdir(mocks.root)).toEqual([]);
	});

	it.each(["PENDING", "UPLOADING", "FINALIZING", "FAILED"])("keeps a %s session's bytes however old", async (status) => {
		// FAILED covers the uploads kept for review: their bytes are the recovery material.
		const kept = await sessionDir("kept", 30 * 24 * HOUR);
		rows({ [kept]: status });

		expect(await sweepOrphanedUploadStaging(now)).toEqual({ directories: 0, files: 0 });
		expect(await readdir(mocks.root)).toEqual([kept]);
	});

	it("removes the temp file of a WebDAV PUT that never ended, and no other file", async () => {
		await stagedPut(`${WEBDAV_PUT_STAGING_PREFIX}dead.tmp`, 25 * HOUR);
		await stagedPut(`${WEBDAV_PUT_STAGING_PREFIX}slow-but-alive.tmp`, 2 * HOUR);
		await stagedPut("notes.txt", 90 * 24 * HOUR);

		expect(await sweepOrphanedUploadStaging(now)).toEqual({ directories: 0, files: 1 });
		expect((await readdir(mocks.root)).sort()).toEqual(["notes.txt", `${WEBDAV_PUT_STAGING_PREFIX}slow-but-alive.tmp`]);
	});

	// MEDIA_UPLOAD_TMP_DIR may name a directory other things live in.
	it("leaves alone a directory that is not named like a session", async () => {
		for (const name of ["systemd-private-1a2b-nginx.service-XyZ", "lost+found", "Backups", ".cache"]) {
			await mkdir(path.join(mocks.root, name));
			await aged(path.join(mocks.root, name), 30 * 24 * HOUR);
		}

		expect(await sweepOrphanedUploadStaging(now)).toEqual({ directories: 0, files: 0 });
		expect(await readdir(mocks.root)).toHaveLength(4);
		expect(mocks.findMany).not.toHaveBeenCalled();
	});

	it("has nothing to do before the first upload", async () => {
		mocks.root = path.join(mocks.root, "never-created");

		expect(await sweepOrphanedUploadStaging(now)).toEqual({ directories: 0, files: 0 });
	});
});
