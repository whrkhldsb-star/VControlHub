// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { catalogues } = vi.hoisted(() => ({ catalogues: new Map<string, Array<Record<string, unknown>>>() }));
vi.mock("../adapters", async (importOriginal) => ({
	...(await importOriginal<typeof import("../adapters")>()),
	fetchSourceApps: vi.fn(async (sourceName: string) => ({ apps: catalogues.get(sourceName) ?? [], complete: true })),
}));

import { prisma } from "@/lib/db";
import { fetchSourceApps } from "../adapters";
import { syncAllSources, syncSource } from "../app-source-sync";

const app = (slug: string, image: string) => ({
	slug, name: slug, category: "other", icon: "📦", description: "", image, defaultPort: 8080, path: "/",
	envJson: {}, volumesJson: [], extraPorts: [],
});

/**
 * App slugs are "<source>-<app>", so two legitimate sources can produce the
 * same slug ("feed" + "tools-demo", "feed-tools" + "demo"). The second sync
 * used to overwrite the first source's app while it stayed owned by the first.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("app source slug collisions (PostgreSQL)", () => {
	const prefix = `src${randomUUID().slice(0, 6)}`;
	const slug = `${prefix}-feed-tools-demo`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
	});
	afterAll(async () => {
		await prisma.appSource.deleteMany({ where: { name: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("does not let one source overwrite another source's app", async () => {
		const first = await prisma.appSource.create({ data: { name: `${prefix}-feed`, displayName: "feed", url: "https://a.example/apps.json" } });
		const second = await prisma.appSource.create({ data: { name: `${prefix}-feed-tools`, displayName: "feed-tools", url: "https://b.example/apps.json" } });
		catalogues.set(first.name, [app(slug, "first/demo:1")]);
		catalogues.set(second.name, [app(slug, "second/demo:1")]);

		await expect(syncSource(first.id)).resolves.toMatchObject({ synced: 1, errors: 0 });
		await expect(syncSource(second.id)).resolves.toMatchObject({ synced: 0, errors: 1 });

		const row = await prisma.appSourceApp.findUniqueOrThrow({ where: { slug } });
		expect(row).toMatchObject({ sourceId: first.id, image: "first/demo:1" });
	});

	it("serializes an all-source snapshot with a newer single-source sync", async () => {
		const source = await prisma.appSource.create({ data: { name: prefix + "-overlap", displayName: "overlap", url: "https://example.test/apps" } });
		const entered = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const key = prefix + "-item";
		const original = vi.mocked(fetchSourceApps).getMockImplementation()!;
		let reads = 0;
		vi.mocked(fetchSourceApps).mockImplementation(async (name, type, url) => {
			if (name !== source.name) return original(name, type, url);
			if (++reads === 1) { entered.resolve(); await finish.promise; return { apps: [], complete: true }; }
			return { apps: [{ ...app(key, "demo/new"), sourceName: name }], complete: true };
		});
		try {
			const all = syncAllSources();
			await entered.promise;
			const single = syncSource(source.id);
			await new Promise(resolve => setTimeout(resolve, 25));
			expect(reads).toBe(1);
			finish.resolve();
			await Promise.all([all, single]);
			expect((await prisma.appSourceApp.findUniqueOrThrow({ where: { slug: key } })).image).toBe("demo/new");
		} finally { finish.resolve(); vi.mocked(fetchSourceApps).mockImplementation(original); }
	});

	it("keeps one owner when two sources sync the same slug at the same time", async () => {
		// Both used to see the slug free, then both wrote it: the second
		// source's image under the first source's ownership.
		const race = `${prefix}-race-x`;
		const a = await prisma.appSource.create({ data: { name: `${prefix}-race`, displayName: "race", url: "https://c.example/apps.json" } });
		const b = await prisma.appSource.create({ data: { name: `${prefix}-race-two`, displayName: "race two", url: "https://d.example/apps.json" } });
		catalogues.set(a.name, [app(race, "a/demo:1")]);
		catalogues.set(b.name, [app(race, "b/demo:1")]);

		const results = await Promise.all([syncSource(a.id), syncSource(b.id)]);
		expect(results.map((result) => result.errors).sort()).toEqual([0, 1]);
		const row = await prisma.appSourceApp.findUniqueOrThrow({ where: { slug: race } });
		expect(row.image).toBe(row.sourceId === a.id ? "a/demo:1" : "b/demo:1");
	});
});

