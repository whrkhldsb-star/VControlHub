/* VControlHub service worker — TR-033 PWA offline support.
 *
 * Caching strategy:
 * - Install: pre-cache only public/offline-safe assets. Protected pages are
 *   deliberately NOT pre-cached during install, because unauthenticated install
 *   fetches can cache login redirects instead of the real page.
 * - Client message VCH_PWA_WARM_ROUTE: after the app is running with a valid
 *   session, warm selected read-only routes into the runtime cache.
 * - Navigation: network-first. If the network fails, serve the exact cached
 *   navigation response when available; otherwise serve /offline.
 * - Static assets: cache-first.
 * - API/cross-origin/non-GET: never cache.
 */

const CACHE_VERSION = "vch-shell-v3";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
	"/offline",
	"/icon-192x192.png",
	"/icon.png",
	"/manifest.webmanifest",
];

const WARMABLE_ROUTES = new Set([
	"/dashboard",
	"/servers",
	"/files",
	"/settings",
	"/status",
	"/notifications",
]);

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

function isApiRequest(url) {
	return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
	return (
		url.pathname.startsWith("/_next/static/") ||
		url.pathname.startsWith("/icon") ||
		url.pathname === "/manifest.webmanifest" ||
		url.pathname === "/favicon.ico"
	);
}

function isCacheablePageResponse(response) {
	const contentType = response.headers.get("content-type") || "";
	return response.ok && contentType.includes("text/html") && response.type !== "opaqueredirect";
}

async function warmRoute(pathname) {
	if (!WARMABLE_ROUTES.has(pathname)) return { ok: false, reason: "route_not_warmable" };
	const request = new Request(pathname, {
		method: "GET",
		credentials: "include",
		headers: { Accept: "text/html" },
	});
	const response = await fetch(request);
	if (!isCacheablePageResponse(response)) {
		return { ok: false, reason: `not_cacheable_${response.status}` };
	}
	const cache = await caches.open(RUNTIME_CACHE);
	await cache.put(request, response.clone());
	return { ok: true, pathname };
}

self.addEventListener("message", (event) => {
	const data = event.data || {};
	if (data.type === "VCH_PWA_SKIP_WAITING") {
		event.waitUntil(self.skipWaiting());
		return;
	}
	if (data.type === "VCH_PWA_CLEAR_CACHES") {
		event.waitUntil(
			caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
		);
		return;
	}
	if (data.type === "VCH_PWA_WARM_ROUTE") {
		event.waitUntil(warmRoute(data.pathname).catch(() => ({ ok: false, reason: "warm_failed" })));
	}
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);

	// Never cache API responses — they always need live data.
	if (isApiRequest(url)) return;

	// Cross-origin: pass through, no caching.
	if (url.origin !== self.location.origin) return;

	// Navigation request (page load).
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (isCacheablePageResponse(response)) {
						const copy = response.clone();
						caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
					}
					return response;
				})
				.catch(async () => {
					const cached = await caches.match(request);
					if (cached) return cached;
					const offline = await caches.match("/offline");
					return offline || new Response("Offline", { status: 503, statusText: "Offline" });
				}),
		);
		return;
	}

	// Same-origin static assets: cache-first.
	if (isStaticAsset(url)) {
		event.respondWith(
			caches.match(request).then((cached) => {
				if (cached) return cached;
				return fetch(request).then((response) => {
					if (response.ok) {
						const copy = response.clone();
						caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
					}
					return response;
				});
			}),
		);
	}
});
