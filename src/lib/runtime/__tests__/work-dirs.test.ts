// @vitest-environment node
import { chmod, mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configMock } = vi.hoisted(() => ({
	configMock: {
		media: { uploadTmpDir: undefined as string | undefined, thumbCacheDir: undefined as string | undefined },
		fileVersion: { dir: undefined as string | undefined },
	},
}));

vi.mock("@/lib/config/env", () => ({ config: configMock }));

/** A fresh copy: the answer is decided once per process. */
async function load() {
	vi.resetModules();
	return import("../work-dirs");
}

let dataRoot: string;

beforeEach(async () => {
	dataRoot = await mkdtemp(path.join(os.tmpdir(), "vch-work-dirs-"));
	configMock.media.uploadTmpDir = undefined;
	configMock.media.thumbCacheDir = undefined;
	configMock.fileVersion.dir = path.join(dataRoot, "file-versions");
});

afterEach(async () => {
	await chmod(dataRoot, 0o700).catch(() => undefined);
});

describe("where upload staging and the thumbnail cache live", () => {
	// /tmp is private to each systemd unit (the worker's sweeps never saw the web process's files) and is
	// memory on a tmpfs host, charged to the web service: two 200 MB uploads at once stalled the site.
	it("is beside the installation's other data, on disk and shared by its processes", async () => {
		const { thumbnailCacheDir, uploadTmpDir } = await load();

		expect(uploadTmpDir()).toBe(path.join(dataRoot, "upload-tmp"));
		expect(thumbnailCacheDir()).toBe(path.join(dataRoot, "thumbnails"));
		// Uploaded bytes of every user: the directory is the service account's alone.
		expect((await stat(uploadTmpDir())).mode & 0o777).toBe(0o700);
	});

	it("is the configured directory when one is set, untouched", async () => {
		configMock.media.uploadTmpDir = "/srv/elsewhere/uploads";
		configMock.media.thumbCacheDir = "/srv/elsewhere/thumbs";
		const { thumbnailCacheDir, uploadTmpDir } = await load();

		expect(uploadTmpDir()).toBe("/srv/elsewhere/uploads");
		expect(thumbnailCacheDir()).toBe("/srv/elsewhere/thumbs");
	});

	it.runIf(process.getuid?.() !== 0)("stays under /tmp where the data directory cannot be written", async () => {
		await chmod(dataRoot, 0o500);
		const { thumbnailCacheDir, uploadTmpDir } = await load();

		expect(uploadTmpDir()).toBe("/tmp/vcontrolhub-media-uploads");
		expect(thumbnailCacheDir()).toBe(path.join(os.tmpdir(), "vcontrolhub-thumbnails"));
	});

	it("stays under /tmp where the data directory is not a directory at all", async () => {
		// As root (containers, this suite's CI) permissions refuse nothing: a file in the way does.
		configMock.fileVersion.dir = path.join("/dev/null", "data", "file-versions");
		const { thumbnailCacheDir, uploadTmpDir } = await load();

		expect(uploadTmpDir()).toBe("/tmp/vcontrolhub-media-uploads");
		expect(thumbnailCacheDir()).toBe(path.join(os.tmpdir(), "vcontrolhub-thumbnails"));
	});

	it("does not follow a relative file-history setting into the working directory", async () => {
		configMock.fileVersion.dir = "file-versions";
		const { uploadTmpDir } = await load();

		expect(uploadTmpDir()).toBe("/tmp/vcontrolhub-media-uploads");
	});

	it("keeps its answer for the life of the process", async () => {
		const { uploadTmpDir } = await load();
		const first = uploadTmpDir();
		configMock.fileVersion.dir = path.join("/dev/null", "file-versions");

		expect(uploadTmpDir()).toBe(first);
	});
});
