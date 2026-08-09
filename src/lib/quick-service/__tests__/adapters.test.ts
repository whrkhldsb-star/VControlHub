import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({
	lookup: lookupMock,
	default: { lookup: lookupMock },
}));

import { fetchSourceApps } from "../adapters";

describe("Quick Services app-source fetch URL boundaries", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("rejects private catalog URLs before fetch", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(fetchSourceApps("local", "json", "http://localhost/apps.json")).rejects.toThrow(/public HTTP\(S\) address/);
		expect(fetchSpy).not.toHaveBeenCalled();

		fetchSpy.mockRestore();
	});

	it("rejects catalog hostnames that resolve to private addresses", async () => {
		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(fetchSourceApps("catalog", "json", "https://catalog.example/apps.json")).rejects.toThrow(/public HTTP\(S\) address/);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("namespaces generic app slugs by source and disables redirects", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify([
			{ name: "Demo App", slug: "demo", image: "example/demo:1", port: 8080 },
		]), { status: 200, headers: { "content-type": "application/json" } }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const first = await fetchSourceApps("catalog-one", "json", "https://catalog.example/one.json");
		const second = await fetchSourceApps("catalog-two", "json", "https://catalog.example/two.json");

		expect(first[0]).toMatchObject({ slug: "catalog-one-demo", sourceName: "catalog-one" });
		expect(second[0]).toMatchObject({ slug: "catalog-two-demo", sourceName: "catalog-two" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://catalog.example/one.json",
			expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
		);
	});

	it("uses LinuxServer image config instead of inventing ports and mounts", async () => {
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
			status: "ok",
			data: { repositories: { linuxserver: [{
				name: "demo-web",
				description: "Demo",
				category: "Web Tools",
				project_logo: "",
				project_url: "",
				github_url: "",
				version: "1",
				stable: true,
				deprecated: false,
				stars: 1,
				monthly_pulls: 2,
				tags: [],
				config: {
					ports: [{ external: "7878", internal: "7878" }, { external: "9898", internal: "9898", optional: true }],
					volumes: [{ path: "/config", optional: false }],
				},
			}] } },
		}), { status: 200 })) as unknown as typeof fetch;

		const apps = await fetchSourceApps("LinuxServer", "linuxserver", "https://api.linuxserver.io/api/v1/images");
		expect(apps[0]).toMatchObject({
			defaultPort: 7878,
			internalPort: 7878,
			envJson: { PUID: "1000", PGID: "1000" },
			volumesJson: [{ host: "/opt/demo-web/config", container: "/config" }],
			extraPorts: [{ host: 9898, container: 9898 }],
		});
	});
});
