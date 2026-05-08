import type { NextConfig } from "next";

const nextConfig: NextConfig = {
 // Enable standalone output for Docker container builds
 output: "standalone",
 // Keep native/CommonJS-heavy SSH dependencies out of Turbopack server chunks.
 // ssh2 loads crypto assets dynamically; bundling it can fail on clean installs.
 serverExternalPackages: ["ssh2"],
};

export default nextConfig;
