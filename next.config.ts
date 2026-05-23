import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
