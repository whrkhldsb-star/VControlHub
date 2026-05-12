import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Standalone output removed — we use custom server (npx tsx src/server.ts)
	// which requires full node_modules for WebSocket support.
	// Re-enable "output: standalone" only if deploying via Docker images.
	serverExternalPackages: ["ssh2"],
	// Image optimization configuration
	images: {
		remotePatterns: [
			{ protocol: "https", hostname: "**" },
		],
		minimumCacheTTL: 3600,
	},
};

export default nextConfig;
