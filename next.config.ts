import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Disable streaming metadata for this SSR-heavy admin console
	htmlLimitedBots: /.*/,
	// Keep native SSH-related packages outside Next's server bundles.
	serverExternalPackages: ["ssh2", "ppk-to-openssh"],
	// Image optimization configuration
	images: {
		remotePatterns: [
			{ protocol: "https", hostname: "**" },
		],
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
		];
	},
};

export default nextConfig;
