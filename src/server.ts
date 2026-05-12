/**
 * Custom server entry point — wraps Next.js standalone server
 * and initializes the WebSocket notification server on the same port.
 *
 * Production mode (NODE_ENV=production):
 *   Loads .next/standalone/server.js and wraps its HTTP server
 *   with WebSocket support. This preserves the memory-efficient
 *   standalone output while adding real-time notifications.
 *
 * Development mode:
 *   Uses next({ dev: true }) directly.
 *
 * Usage:
 *   Production: npx tsx src/server.ts   (from project root with full node_modules)
 *   Or:         node .next/standalone/server.js  (standalone, no WS support)
 *   Development: npm run dev
 */
import { createServer } from "node:http";
import path from "node:path";

import { setupWebSocketServer } from "@/lib/ws/notification-ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
	if (dev) {
		// ── Development: use next() directly ──
		const next = (await import("next")).default;
		const app = next({ dev: true, hostname, port });
		const handle = app.getRequestHandler();
		await app.prepare();

		const server = createServer(async (req, res) => {
			await handle(req, res);
		});

		setupWebSocketServer(server);

		server.listen(port, hostname, () => {
			console.log(`[server] Next.js (dev) + WS listening on http://${hostname}:${port}`);
		});
	} else {
		// ── Production: import standalone server.js and hook WebSocket ──
		// The standalone output creates its own HTTP server via startServer().
		// We intercept it by temporarily overriding http.createServer to capture
		// the server instance, then attach our WebSocket handler.
		const http = await import("node:http");
		const originalCreateServer = http.createServer;
		let capturedServer: import("node:http").Server | null = null;

		// Temporarily intercept http.createServer to capture the server instance
		// that Next.js standalone server.js creates internally.
		http.createServer = function (...args: unknown[]) {
			const server = originalCreateServer.apply(http, args as Parameters<typeof originalCreateServer>);
			capturedServer = server;
			// Restore original immediately — only the first call matters
			http.createServer = originalCreateServer;
			return server;
		};

		// Import standalone server.js — it calls startServer() which calls createServer()
		const standalonePath = path.join(process.cwd(), ".next", "standalone", "server.js");
		try {
			await import(standalonePath);
		} catch {
			// Fallback: try relative to the project root
			console.warn("[server] Could not load .next/standalone/server.js, falling back to next()");
			const next = (await import("next")).default;
			const app = next({ dev: false, hostname, port });
			const handle = app.getRequestHandler();
			await app.prepare();

			const fallbackServer = createServer(async (req, res) => {
				await handle(req, res);
			});
			capturedServer = fallbackServer;
			fallbackServer.listen(port, hostname);
		}

		// Wait briefly for the server to be created by standalone's startServer()
		await new Promise((resolve) => setTimeout(resolve, 100));

		if (capturedServer) {
			setupWebSocketServer(capturedServer);
			console.log(`[server] WebSocket notifications attached to Next.js standalone server on port ${port}`);
		} else {
			console.warn("[server] Could not capture HTTP server — WebSocket notifications unavailable");
		}
	}
}

main().catch((err) => {
	console.error("[server] Failed to start:", err);
	process.exit(1);
});
