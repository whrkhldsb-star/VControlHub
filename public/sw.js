/* VControlHub service worker — TR-033 PWA offline support.
 *
 * Caching strategy:
 * - Install: pre-cache only public/offline-safe assets. Protected pages are
 *   deliberately NOT pre-cached during install, because unauthenticated install
 *   fetches can cache login redirects instead of the real page.
 * - Navigation: network-only with a public /offline fallback. Authenticated
 *   HTML is never persisted in Cache Storage.
 * - Static assets: cache-first.
 * - API/cross-origin/non-GET: never cache.
 */

const CACHE_VERSION = "vch-shell-v4";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
	"/offline",
	"/icon-192x192.png",
	"/icon.png",
	"/manifest.webmanifest",
];

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
				.catch(async () => {
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
