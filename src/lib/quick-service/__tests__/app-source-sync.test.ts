import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchSourceAppsMock } = vi.hoisted(() => ({
	prismaMock: {
		appSource: {
			findMany: vi.fn(),
		},
		appSourceApp: {
			findMany: vi.fn(),
		},
	},
	fetchSourceAppsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("../adapters", () => ({ fetchSourceApps: fetchSourceAppsMock }));

const { getRemoteApps, syncAllSources } = await import("../app-source-sync");

describe("app source catalog bounds", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.appSource.findMany.mockResolvedValue([]);
		prismaMock.appSourceApp.findMany.mockResolvedValue([]);
	});

	it("limits remote Quick Services catalog reads so the API cannot hydrate an unbounded app list", async () => {
		prismaMock.appSourceApp.findMany.mockResolvedValueOnce([
			{
				slug: "jellyfin",
				name: "Jellyfin",
				category: "media",
				icon: "tv",
				description: "Media server",
				image: "jellyfin/jellyfin:latest",
				defaultPort: 8096,
				internalPort: null,
				path: "/",
				envJson: "{}",
				volumesJson: "[]",
				command: null,
				extraPortsJson: "[]",
				sourceVersion: null,
				source: { name: "LinuxServer" },
			},
		]);

		await expect(getRemoteApps()).resolves.toEqual([
			expect.objectContaining({ slug: "jellyfin", sourceName: "LinuxServer" }),
		]);
		expect(prismaMock.appSourceApp.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { source: { enabled: true } },
			orderBy: [{ category: "asc" }, { name: "asc" }],
			take: 500,
		}));
	});

	it("limits enabled app-source sync enumeration and processes sources deterministically", async () => {
		prismaMock.appSource.findMany.mockResolvedValueOnce([]);

		await expect(syncAllSources()).resolves.toEqual([]);

		expect(prismaMock.appSource.findMany).toHaveBeenCalledWith({
			where: { enabled: true },
			orderBy: { createdAt: "asc" },
			take: 50,
		});
		expect(fetchSourceAppsMock).not.toHaveBeenCalled();
	});
});