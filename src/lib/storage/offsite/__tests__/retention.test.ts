import { beforeEach, describe, expect, it, vi } from "vitest";

const { listObjects, deleteObject, appRows, vpsRows } = vi.hoisted(() => ({
	listObjects: vi.fn(),
	deleteObject: vi.fn(async () => undefined),
	appRows: vi.fn(),
	vpsRows: vi.fn(),
}));
vi.mock("../s3-client", () => ({
	S3Client: class {
		listObjects = listObjects;
		deleteObject = deleteObject;
	},
}));
vi.mock("../schema", () => ({
	loadOffsiteConfig: vi.fn(async () => ({ enabled: true, endpoint: "https://s3.test", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s", pathPrefix: "vch/", retentionDays: 7 })),
	validateOffsiteConfigForUse: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => ({
	prisma: { backupRecord: { findMany: appRows }, vpsBackupRecord: { findMany: vpsRows } },
}));

import { pruneOffsiteObjects } from "../retention";

describe("pruneOffsiteObjects", () => {
	beforeEach(() => vi.clearAllMocks());

	it("never prunes the newest offsite copy of a kind, however old", async () => {
		// Uploads failing for longer than the window: every object is old.
		const old = "2026-01-01T00:00:00.000Z";
		listObjects.mockResolvedValueOnce({
			objects: [
				{ key: "vch/2026-01-01/a-database.gz", lastModified: old },
				{ key: "vch/2026-01-02/b-database.gz", lastModified: old },
				{ key: "vch/srv/full-c.tar.gz", lastModified: old },
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
});
