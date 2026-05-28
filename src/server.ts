/**
 * Custom server entry point — wraps Next.js with WebSocket notification support.
 *
 * Production: uses next({ dev: false }) directly (not standalone).
 *   This gives us full control of the HTTP server instance to attach
 *   WebSocket handlers. The standalone output (.next/standalone/server.js)
 *   does not expose its server instance, making WS hooking impossible.
 *
 * Development: uses next({ dev: true }).
 *
 * Usage:  npx tsx src/server.ts
 *   (requires full node_modules — do NOT use .next/standalone/server.js)
 */
import { createServer } from "node:http";
import next from "next";

import { setupWebSocketServer } from "@/lib/ws/notification-ws";
import { createLogger } from "@/lib/logging";

const logger = createLogger("server");

const dev = process.env.NODE_ENV !== "production";
// Bind to loopback by default in production; containers can set NEXT_HOST=0.0.0.0.
const hostname = process.env.NEXT_HOST?.trim() || (dev ? "0.0.0.0" : "127.0.0.1");
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
	const app = next({ dev, hostname, port });
	const handle = app.getRequestHandler();

	await app.prepare();

	const server = createServer(async (req, res) => {
		await handle(req, res);
	});

	// Attach WebSocket notification server (handles /ws upgrade)
	setupWebSocketServer(server);

	server.listen(port, hostname, () => {
		logger.info(`Next.js (${dev ? "dev" : "prod"}) + WS listening on http://${hostname}:${port}`);
	});
}

main().catch((err) => {
	logger.error("Failed to start:", err);
	process.exit(1);
});
