import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Disable streaming metadata for this SSR-heavy admin console. In production,
	// streamed <head> updates can race with App Router hydration and surface as
	// React #418 text mismatches during authenticated navigation dogfood.
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
};

export default nextConfig;
