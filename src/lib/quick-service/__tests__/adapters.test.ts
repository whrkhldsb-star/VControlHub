import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({
	lookup: lookupMock,
	default: { lookup: lookupMock },
}));
// These tests drive a mocked global fetch; the pinned dispatcher underneath
// the real helper is covered by pinned-fetch.test.ts.
vi.mock("@/lib/security/pinned-fetch", () => ({
	fetchWithPinnedDns: (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init),
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

	it("refuses a 200 response that is not a catalogue instead of reading it as empty", async () => {
		// Read as an empty catalogue, the sync deleted every app of the source
		// and recorded success.
		const errorBody = { status: "error", message: "temporary backend failure" };
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(errorBody), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
		await expect(fetchSourceApps("catalog", "json", "https://catalog.example/apps.json")).rejects.toThrow();
		await expect(fetchSourceApps("lsio", "linuxserver", "https://catalog.example/lsio.json")).rejects.toThrow();
	});

	it("still accepts a well-formed empty catalogue", async () => {
		globalThis.fetch = vi.fn(async (url: string | URL) => new Response(
			JSON.stringify(String(url).includes("lsio") ? { status: "OK", data: { repositories: { linuxserver: [] } } } : { apps: [] }),
			{ status: 200, headers: { "content-type": "application/json" } },
		)) as unknown as typeof fetch;
		await expect(fetchSourceApps("catalog", "json", "https://catalog.example/apps.json")).resolves.toEqual([]);
		await expect(fetchSourceApps("lsio", "linuxserver", "https://catalog.example/lsio.json")).resolves.toEqual([]);
	});
});


/** Entries of the live LinuxServer catalogue (api.linuxserver.io, 2026-10-24), trimmed to the fields read. */
const LSIO_IMAGES = [
	{
		"name": "heimdall",
		"description": "",
		"category": "Dashboard",
		"project_logo": "",
		"project_url": "",
		"github_url": "",
		"version": "v2.8.3-ls369",
		"stable": true,
		"deprecated": false,
		"stars": 0,
		"monthly_pulls": 0,
		"tags": [],
		"config": {
			"ports": [
				{
					"external": "80",
					"internal": "80"
				},
				{
					"external": "443",
					"internal": "443"
				}
			]
		}
	},
	{
		"name": "luanti",
		"description": "",
		"category": "Games",
		"project_logo": "",
		"project_url": "",
		"github_url": "",
		"version": "5.18.0-rc1-ls50",
		"stable": true,
		"deprecated": false,
		"stars": 0,
		"monthly_pulls": 0,
		"tags": [],
		"config": {
			"ports": [
				{
					"external": "30000",
					"internal": "30000/udp"
				}
			]
		}
	},
	{
		"name": "syslog-ng",
		"description": "",
		"category": "Monitoring",
		"project_logo": "",
		"project_url": "",
		"github_url": "",
		"version": "4.11.0-r0-ls212",
		"stable": true,
		"deprecated": false,
		"stars": 0,
		"monthly_pulls": 0,
		"tags": [],
		"config": {
			"ports": [
				{
					"external": "514",
					"internal": "5514/udp"
				},
				{
					"external": "601",
					"internal": "6601/tcp"
				},
				{
					"external": "6514",
					"internal": "6514/tcp"
				}
			]
		}
	},
	{
		"name": "wireguard",
		"description": "",
		"category": "Network,VPN",
		"project_logo": "",
		"project_url": "",
		"github_url": "",
		"version": "1.0.20260223-r0-ls127",
		"stable": true,
		"deprecated": false,
		"stars": 0,
		"monthly_pulls": 0,
		"tags": [],
		"config": {
			"ports": [
				{
					"external": "51820",
					"internal": "51820/udp"
				}
			]
		}
	}
];

describe("LinuxServer catalogue with UDP ports", () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("skips UDP-only images instead of failing the whole sync, and keeps \"/tcp\" ports", async () => {
		// WireGuard declares only "51820/udp": read as a number it left no port,
		// the mapping threw, and not one app of the source was synced.
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ status: "OK", data: { repositories: { linuxserver: LSIO_IMAGES } } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;

		const apps = await fetchSourceApps("linuxserver", "linuxserver", "https://api.linuxserver.io/api/v1/images?include_config=true");
		const bySlug = Object.fromEntries(apps.map((app) => [app.slug, app]));

		expect(Object.keys(bySlug).sort()).toEqual(["linuxserver-heimdall", "linuxserver-syslog-ng"]);
		// syslog-ng's TCP ports are written "6601/tcp"; its UDP one is left out.
		expect(bySlug["linuxserver-syslog-ng"]).toMatchObject({ defaultPort: 601, internalPort: 6601, extraPorts: [{ host: 6514, container: 6514 }] });
		expect(bySlug["linuxserver-heimdall"]).toMatchObject({ defaultPort: 80, internalPort: 80 });
	});
});
