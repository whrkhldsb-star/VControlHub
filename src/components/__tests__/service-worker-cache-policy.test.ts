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
		const names = new Set(["vch-shell-v4-shell", "vch-shell-v5-shell", "vch-shell-v5-runtime", "other-app-offline"]);
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
			expect([...names]).toEqual(event === "activate" ? ["vch-shell-v5-shell", "vch-shell-v5-runtime", "other-app-offline"] : ["other-app-offline"]);
		}
	});

	it("supports skip-waiting so the update prompt can activate a new worker", () => {
		expect(swSource).toContain("VCH_PWA_SKIP_WAITING");
		expect(swSource).toContain("self.skipWaiting()");
	});
});
