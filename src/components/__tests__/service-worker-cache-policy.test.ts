import fs from "node:fs";
import path from "node:path";

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

	it("never stores authenticated navigation responses", () => {
		const navigationBlock = swSource.slice(
			swSource.indexOf('if (request.mode === "navigate")'),
			swSource.indexOf("// Same-origin static assets"),
		);
		expect(swSource).not.toContain("VCH_PWA_WARM_ROUTE");
		expect(navigationBlock).not.toContain("cache.put");
		expect(navigationBlock).not.toContain("caches.match(request)");
		expect(navigationBlock).toContain('caches.match("/offline")');
	});

	it("keeps API requests out of the cache", () => {
		expect(swSource).toContain("function isApiRequest");
		expect(swSource).toContain('url.pathname.startsWith("/api/")');
		expect(swSource).toContain("if (isApiRequest(url)) return;");
	});

	it("supports skip-waiting so the update prompt can activate a new worker", () => {
		expect(swSource).toContain("VCH_PWA_SKIP_WAITING");
		expect(swSource).toContain("self.skipWaiting()");
	});
});
