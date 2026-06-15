import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, fetchSourceAppsMock } = vi.hoisted(() => ({
	prismaMock: {
		appSource: {
			findMany: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		appSourceApp: {
			findMany: vi.fn(),
			upsert: vi.fn(),
			deleteMany: vi.fn(),
		},
	},
	fetchSourceAppsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("../adapters", () => ({ fetchSourceApps: fetchSourceAppsMock }));

const { getRemoteApps, syncAllSources, syncSource } = await import("../app-source-sync");

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

	it("TR-040 R1: syncSource fans out every app upsert in a single Promise.all (no chunking)", async () => {
		// Generate 20 fake apps so we exercise the full fan-out.
		const fakeApps = Array.from({ length: 20 }, (_, i) => ({
			slug: `app-${i}`,
			name: `App ${i}`,
			category: "test",
			icon: "x",
			description: "",
			image: `img-${i}`,
			defaultPort: 8000 + i,
			internalPort: null,
			path: "/",
			envJson: {},
			volumesJson: [],
			command: null,
			extraPorts: [],
			rawJson: null,
			sourceVersion: null,
		}));

		prismaMock.appSource.findUnique.mockResolvedValue({ id: "src1", name: "X", type: "lscr", url: "u", enabled: true });
		fetchSourceAppsMock.mockResolvedValueOnce(fakeApps);
		prismaMock.appSourceApp.upsert.mockResolvedValue({});
		prismaMock.appSourceApp.findMany.mockResolvedValueOnce([]);
		prismaMock.appSource.update.mockResolvedValue({});

		// Track the maximum number of upsert calls that were in-flight at once.
		let inFlight = 0;
		let maxInFlight = 0;
		prismaMock.appSourceApp.upsert.mockImplementation(async () => {
			inFlight++;
			if (inFlight > maxInFlight) maxInFlight = inFlight;
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return {};
		});

		const result = await syncSource("src1");

		expect(result.synced).toBe(20);
		expect(result.errors).toBe(0);
		expect(prismaMock.appSourceApp.upsert).toHaveBeenCalledTimes(20);
		// All 20 fan out in parallel — concurrency must equal N (chunking removed).
		expect(maxInFlight).toBe(20);
	});

	it("TR-040: syncSource isolates a single app failure without aborting the chunk", async () => {
		const apps = [
			{ slug: "ok-1", name: "ok-1", category: "t", icon: "x", description: "", image: "i", defaultPort: 1, internalPort: null, path: "/", envJson: {}, volumesJson: [], command: null, extraPorts: [], rawJson: null, sourceVersion: null },
			{ slug: "bad", name: "bad", category: "t", icon: "x", description: "", image: "i", defaultPort: 2, internalPort: null, path: "/", envJson: {}, volumesJson: [], command: null, extraPorts: [], rawJson: null, sourceVersion: null },
			{ slug: "ok-2", name: "ok-2", category: "t", icon: "x", description: "", image: "i", defaultPort: 3, internalPort: null, path: "/", envJson: {}, volumesJson: [], command: null, extraPorts: [], rawJson: null, sourceVersion: null },
		];
		prismaMock.appSource.findUnique.mockResolvedValue({ id: "src1", name: "X", type: "lscr", url: "u", enabled: true });
		fetchSourceAppsMock.mockResolvedValueOnce(apps);
		prismaMock.appSourceApp.findMany.mockResolvedValueOnce([]);
		prismaMock.appSource.update.mockResolvedValue({});

		prismaMock.appSourceApp.upsert.mockImplementation(async (args: { where: { slug: string } }) => {
			if (args.where.slug === "bad") throw new Error("boom");
			return {};
		});

		const result = await syncSource("src1");
		expect(result.synced).toBe(2);
		expect(result.errors).toBe(1);
	});
});