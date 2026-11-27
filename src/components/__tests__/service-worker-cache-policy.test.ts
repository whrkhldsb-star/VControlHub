import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const swSource = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");

describe("public/sw.js PWA cache policy", () => {
	it("does not pre-cache authenticated app pages during install", () => {
		const precacheBlock = swSource.slice(
			swSource.indexOf("const PRECACHE_URLS"),
			swSource.indexOf('self.addEventListener("install"'),
		);
		expect(precacheBlock).toContain('"/offline"');
		expect(precacheBlock).not.toContain('"/dashboard"');
		expect(precacheBlock).not.toContain('"/servers"');
		expect(precacheBlock).not.toContain('"/files"');
		expect(precacheBlock).not.toContain('"/settings"');
	});

	it("pre-caches without the visitor's cookies, so the offline page never holds someone's signed-in shell", () => {
		const installBlock = swSource.slice(
			swSource.indexOf('self.addEventListener("install"'),
			swSource.indexOf('self.addEventListener("activate"'),
		);
		expect(installBlock).toContain('credentials: "omit"');
	});

	it("never stores authenticated navigation responses", () => {
		const navigationBlock = swSource.slice(
			swSource.indexOf('if (request.mode === "navigate")'),
			swSource.indexOf("// Same-origin static assets"),
		);
		expect(swSource).not.toContain("VCH_PWA_WARM_ROUTE");
		expect(navigationBlock).not.toContain("cache.put");
		expect(navigationBlock).not.toContain("caches.match(request)");
		expect(navigationBlock).toContain('caches.match("/offline", { cacheName: SHELL_CACHE })');
	});

	it("keeps API requests out of the cache", () => {
		expect(swSource).toContain("function isApiRequest");
		expect(swSource).toContain('url.pathname.startsWith("/api/")');
		expect(swSource).toContain("if (isApiRequest(url)) return;");
	});

	it("limits cache cleanup on activation and sign-out to VControlHub caches", async () => {
		const names = new Set(["vch-shell-v4-shell", "vch-shell-v5-shell", "vch-shell-v5-runtime", "vch-shell-v6-shell", "vch-shell-v6-runtime", "other-app-offline"]);
		type WorkerEvent = { data?: { type: string }; waitUntil: (work: Promise<unknown>) => void };
		const listeners = new Map<string, (event: WorkerEvent) => void>();
		runInNewContext(swSource, {
			self: { addEventListener: listeners.set.bind(listeners), clients: { claim() {} } },
			caches: { keys: async () => [...names], delete: async (key: string) => names.delete(key) },
		});
		for (const event of ["activate", "message"]) {
			let work: Promise<unknown> | undefined;
			listeners.get(event)!({ data: { type: "VCH_PWA_CLEAR_CACHES" }, waitUntil: (task) => { work = task; } });
			await work;
			expect([...names]).toEqual(event === "activate" ? ["vch-shell-v6-shell", "vch-shell-v6-runtime", "other-app-offline"] : ["other-app-offline"]);
		}
	});

	it("supports skip-waiting so the update prompt can activate a new worker", () => {
		expect(swSource).toContain("VCH_PWA_SKIP_WAITING");
		expect(swSource).toContain("self.skipWaiting()");
	});

	it("matches only the exact public icon assets, not an /icon prefix", () => {
		expect(swSource).toContain('const ICON_ASSETS = new Set(["/icon.png", "/icon-192x192.png", "/apple-icon.png", "/favicon.ico"])');
		expect(swSource).not.toContain('url.pathname.startsWith("/icon")');
	});

	it("serves the manifest stale-while-revalidate and refreshes the cache in the background", () => {
		const manifestBlock = swSource.slice(swSource.indexOf("if (isManifest(url))"));
		expect(manifestBlock).toContain("caches.match(request, { cacheName: SHELL_CACHE })");
		expect(manifestBlock).toContain("cache.put(request, copy)");
		expect(manifestBlock).toContain("event.waitUntil(refresh)");
		expect(manifestBlock).toContain('credentials: "omit"');
		// Stale copy wins: the cached response is returned without awaiting the network.
		expect(manifestBlock).toContain("cached || (await refresh)");
		// The static-asset matcher no longer includes the manifest.
		const staticMatcher = swSource.slice(swSource.indexOf("function isStaticAsset"), swSource.indexOf("function isManifest"));
		expect(staticMatcher).not.toContain("manifest");
	});

	it("bumps the cache version so old prefixed-match caches are dropped on activate", () => {
		expect(swSource).toContain('`${CACHE_PREFIX}v6`');
	});
});
