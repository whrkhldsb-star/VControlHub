/* VControlHub service worker — TR-033 PWA (route b, next-pwa equivalent).
 *
 * Why a hand-rolled service worker instead of next-pwa:
 * - The VControlHub app uses Next.js 16 App Router, where the official
 *   PWA story is `app/manifest.ts` + a hand-written `public/sw.js` (see
 *   node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md).
 *   The `next-pwa` community package requires Webpack-specific config
 *   and is not the canonical path on Next 16.
 * - We only need a small, well-defined offline experience: pre-cache the
 *   app shell + four read-only routes, network-first for navigations,
 *   cache-first for static assets. Workbox would be overkill.
 *
 * Caching strategy:
 * - On install: pre-cache the offline page + four read-only routes.
 * - On activate: clean up old cache versions.
 * - On fetch:
 *   1. Navigation requests → try network first; on failure serve the
 *      cached version of the requested page if present, otherwise fall
 *      back to the cached `/offline` page.
 *   2. Same-origin static assets (/_next/static/, /icon*, /manifest*)
 *      → cache-first.
 *   3. Same-origin API requests → always network, never cache.
 *   4. Cross-origin requests → always network, never cache.
 *
 * Versioning: bump CACHE_VERSION when the cache shape changes so
 * activate() can clear stale entries.
 */
/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "vch-shell-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
	"/offline",
	"/dashboard",
	"/servers",
	"/files",
	"/settings",
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
						.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE && !key.startsWith(CACHE_VERSION))
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
					const copy = response.clone();
					caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
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
					const copy = response.clone();
					caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
					return response;
				});
			}),
		);
	}
});
