import { beforeEach, describe, expect, it, vi } from "vitest";

const { listObjects, deleteObject, appRows, vpsRows, appUpdate, vpsUpdate } = vi.hoisted(() => ({
	listObjects: vi.fn(),
	deleteObject: vi.fn(async (_key: string) => undefined),
	appRows: vi.fn(),
	vpsRows: vi.fn().mockResolvedValue([]),
	appUpdate: vi.fn(async () => ({ count: 1 })),
	vpsUpdate: vi.fn(async () => ({ count: 0 })),
}));
vi.mock("../s3-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("../s3-client")>()),
	S3Client: class {
		listObjects = listObjects;
		deleteObject = deleteObject;
	},
}));
vi.mock("../schema", () => ({
	loadOffsiteConfig: vi.fn(async () => ({ enabled: true, provider: "s3", endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", pathPrefix: "vch/", retentionDays: 7 })),
	validateOffsiteConfigForUse: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => ({
	prisma: { $transaction: (updates: Promise<unknown>[]) => Promise.all(updates), backupRecord: { findMany: appRows, updateMany: appUpdate }, vpsBackupRecord: { findMany: vpsRows, updateMany: vpsUpdate } },
}));

import { pruneOffsiteObjects } from "../retention";

describe("pruneOffsiteObjects", () => {
	beforeEach(() => vi.clearAllMocks());

	it("skips unrepresentable listed keys before clearing references or choosing the newest recovery", async () => {
		const keys = ["vch/./a.gz", "vch/recovery/../b.gz", "vch/recovery/keep.gz", "vch/archive..gz"];
		listObjects.mockResolvedValueOnce({ objects: keys.map((key, i) => ({
			key, size: 20, lastModified: i === 1 ? "2026-03-01" : "2026-01-01",
		})) });
		appRows.mockResolvedValueOnce([]);
		const summary = await pruneOffsiteObjects({ now: new Date("2026-10-20") });
		expect(summary.errors).toHaveLength(2);
		expect(summary.deleted).toBe(1);
		expect(deleteObject.mock.calls).toEqual([["vch/archive..gz"]]);
		expect(appUpdate).toHaveBeenCalledTimes(1);
		expect(vpsUpdate).toHaveBeenCalledTimes(1);
	});

	it("never prunes the newest offsite copy of a kind, however old", async () => {
		// Uploads failing for longer than the window: every object is old.
		const old = "2026-01-01T00:00:00.000Z";
		listObjects.mockResolvedValueOnce({
			objects: [
				{ key: "vch/2026-01-01/a-database.gz", size: 42, lastModified: old },
				{ key: "vch/2026-01-02/b-database.gz", size: 42, lastModified: old },
				{ key: "vch/srv/full-c.tar.gz", size: 42, lastModified: old },
			],
			isTruncated: false,
		});
		appRows.mockResolvedValueOnce([{ offsiteKey: "vch/2026-01-02/b-database.gz" }]);
		vpsRows.mockResolvedValueOnce([{ offsiteKey: "vch/srv/full-c.tar.gz" }]);

		const summary = await pruneOffsiteObjects({ now: new Date("2026-10-20T00:00:00Z") });

		expect(summary.deleted).toBe(1);
		expect(deleteObject).toHaveBeenCalledTimes(1);
		expect(deleteObject).toHaveBeenCalledWith("vch/2026-01-01/a-database.gz");
	});

	it("clears the offsite key of the records whose object it deleted, so nothing keeps offering a copy that is gone", async () => {
		listObjects.mockResolvedValueOnce({
			objects: [{ key: "vch/2026-01-01/a-database.gz", size: 42, lastModified: "2026-01-01T00:00:00.000Z" }],
			isTruncated: false,
		});
		appRows.mockResolvedValueOnce([]);
		vpsRows.mockResolvedValueOnce([]);

		await pruneOffsiteObjects({ now: new Date("2026-10-20T00:00:00Z") });

		expect(deleteObject).toHaveBeenCalledWith("vch/2026-01-01/a-database.gz");
		expect(appUpdate).toHaveBeenCalledWith({ where: { offsiteKey: "vch/2026-01-01/a-database.gz" }, data: { offsiteKey: null, offsiteUploadedAt: null, offsiteSize: "42" } });
		expect(vpsUpdate).toHaveBeenCalledWith({ where: { offsiteDestination: JSON.stringify(["s3", "https://s3.test", "r", "b"]), offsiteKey: "vch/2026-01-01/a-database.gz" }, data: { offsiteKey: null, offsiteUploadedAt: null, offsiteSize: "42" } });
	});

	it("keeps the object available for retry if expiring database references fails", async () => {
		listObjects.mockResolvedValue({ objects: [{ key: "vch/old", size: 0, lastModified: "2026-01-01" }] });
		appRows.mockResolvedValue([]);
		vpsRows.mockResolvedValue([]);
		vpsUpdate.mockRejectedValueOnce(new Error("database unavailable"));
		const result = await pruneOffsiteObjects({ now: new Date("2026-10-20") });
		expect(result.deleted).toBe(0);
		expect(result.errors).toEqual(["vch/old: database unavailable"]);
		expect(deleteObject).not.toHaveBeenCalled();
	});

	it("keeps the newest disaster-recovery bundle even when every one is past the retention window", async () => {
		// Uploaded by a script, no database row: age alone used to remove the last one too.
		listObjects.mockResolvedValueOnce({
			objects: [
				{ key: "vch/recovery/old-1.tar.gz", size: 42, lastModified: "2026-01-01T00:00:00.000Z" },
				{ key: "vch/recovery/newest-2.tar.gz", size: 42, lastModified: "2026-03-01T00:00:00.000Z" },
				{ key: "vch/recovery/old-3.tar.gz", size: 42, lastModified: "2026-02-01T00:00:00.000Z" },
			],
			isTruncated: false,
		});
		appRows.mockResolvedValueOnce([]);
		vpsRows.mockResolvedValueOnce([]);

		const summary = await pruneOffsiteObjects({ now: new Date("2026-10-20T00:00:00Z") });

		expect(summary.deleted).toBe(2);
		expect(deleteObject.mock.calls.map(([key]) => key).sort()).toEqual(["vch/recovery/old-1.tar.gz", "vch/recovery/old-3.tar.gz"]);
	});

	it("lets old recovery bundles go once a newer one is inside the window", async () => {
		listObjects.mockResolvedValueOnce({
			objects: [
				{ key: "vch/recovery/old-1.tar.gz", size: 42, lastModified: "2026-01-01T00:00:00.000Z" },
				{ key: "vch/recovery/fresh.tar.gz", size: 42, lastModified: "2026-10-19T00:00:00.000Z" },
			],
			isTruncated: false,
		});
		appRows.mockResolvedValueOnce([]);
		vpsRows.mockResolvedValueOnce([]);

		await pruneOffsiteObjects({ now: new Date("2026-10-20T00:00:00Z") });

		expect(deleteObject.mock.calls.map(([key]) => key)).toEqual(["vch/recovery/old-1.tar.gz"]);
	});
});
