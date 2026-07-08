import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Disable streaming metadata for this SSR-heavy admin console
	htmlLimitedBots: /.*/,
	// Keep native SSH-related packages outside Next's server bundles.
	serverExternalPackages: ["ssh2", "ppk-to-openssh"],
	// Per-package tree-shake hints (lucide-react removed — project uses inline SVG icons now).
	// Image optimization configuration
	images: {
		// Restrict remote image optimization to same-origin only.
		// Allowing arbitrary hostnames ("**") creates an SSRF vector via
		// /_next/image?url=https://internal-service/...
		remotePatterns: [],
		minimumCacheTTL: 3600,
	},
	// Performance: enable gzip/brotli compression
	compress: true,
	// Custom production server (src/server.ts) attaches WebSocket handlers and
	// command-maintenance workers directly. It intentionally runs against the
	// full Next.js app output instead of .next/standalone/server.js, so do not
	// enable output: "standalone" here; Next.js warns at runtime when custom
	// servers call next({ dev: false }) with standalone output enabled.
	// Add cache headers to static assets
	async headers() {
		return [
			{
				source: "/_next/static/(.*)",
				headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
			},
			{
				source: "/api/(status|system-health|tickets|notifications)",
				headers: [
					{ key: "Cache-Control", value: "private, max-age=10, stale-while-revalidate=20" },
				],
			},
			{
				// Service worker (TR-033 PWA) must be served with the correct
				// Content-Type and Cache-Control so the browser can pick it up
				// and the user always receives the latest version on next visit.
				source: "/sw.js",
				headers: [
					{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
					{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
					{ key: "Service-Worker-Allowed", value: "/" },
				],
			},
			{
				// PWA web manifest (TR-033 PWA) — must be served as webmanifest
				// so browsers can read it without a 404 or wrong-type fallback.
				source: "/manifest.webmanifest",
				headers: [
					{ key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
					{ key: "Cache-Control", value: "public, max-age=3600" },
				],
			},
		];
	},
};

export default nextConfig;
