/* VControlHub service worker — TR-033 PWA offline support.
 *
 * Caching strategy:
 * - Install: pre-cache only public/offline-safe assets. Protected pages are
 *   deliberately NOT pre-cached during install, because unauthenticated install
 *   fetches can cache login redirects instead of the real page.
 * - Navigation: network-only with a public /offline fallback. Authenticated
 *   HTML is never persisted in Cache Storage.
 * - Static assets: cache-first on an exact icon set.
 * - Manifest: stale-while-revalidate (cached copy served immediately,
 *   refreshed in the background).
 * - API/cross-origin/non-GET: never cache.
 */

// v6: the static-asset matcher used a prefix match on "/icon" that grew the
// runtime cache with any future route starting the same way; it now serves an
// exact icon set, and /manifest.webmanifest moved to stale-while-revalidate so
// an offline install can still resolve the manifest from the cache.
const CACHE_PREFIX = "vch-shell-";
const CACHE_VERSION = `${CACHE_PREFIX}v6`;
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
			// Without cookies: a worker installed while someone is signed in stored the page with their shell,
			// and any later visitor of that browser saw it offline.
			.then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { credentials: "omit" }))).catch(() => undefined))
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
						.filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

function isApiRequest(url) {
	return url.pathname.startsWith("/api/");
}

// The exact public icon assets. A prefix match on "/icon" also matched any
// future page whose path starts with "icon"; an exact set stays bounded.
const ICON_ASSETS = new Set(["/icon.png", "/icon-192x192.png", "/apple-icon.png", "/favicon.ico"]);

function isStaticAsset(url) {
	return (
		url.pathname.startsWith("/_next/static/") ||
		ICON_ASSETS.has(url.pathname)
	);
}

function isManifest(url) {
	return url.pathname === "/manifest.webmanifest";
}

self.addEventListener("message", (event) => {
	const data = event.data || {};
	if (data.type === "VCH_PWA_SKIP_WAITING") {
		event.waitUntil(self.skipWaiting());
		return;
	}
	if (data.type === "VCH_PWA_CLEAR_CACHES") {
		event.waitUntil(
			caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)))),
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
					const offline = await caches.match("/offline", { cacheName: SHELL_CACHE });
					return offline || new Response("Offline", { status: 503, statusText: "Offline" });
				}),
		);
		return;
	}

	// Same-origin static assets: cache-first.
	if (isStaticAsset(url)) {
		event.respondWith(
			caches.match(request, { cacheName: SHELL_CACHE }).then(async (precached) => {
				const cached = precached || await caches.match(request, { cacheName: RUNTIME_CACHE });
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
		return;
	}

	// Manifest: stale-while-revalidate. Serve the cached copy when present (an
	// offline install still resolves branding/icons) while a background fetch
	// (kept alive via event.waitUntil and omitting cookies) refreshes the cache
	// for the next load.
	if (isManifest(url)) {
		const refresh = fetch(new Request(request.url, { credentials: "omit" }))
			.then(async (response) => {
				if (response.ok) {
					const copy = response.clone();
					await caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
				}
				return response;
			})
			.catch(() => undefined);
		event.waitUntil(refresh);
		event.respondWith(
			caches.match(request, { cacheName: SHELL_CACHE }).then(async (cached) => {
				return cached || (await refresh) || new Response("Offline", { status: 503, statusText: "Offline" });
			}),
		);
	}
});
