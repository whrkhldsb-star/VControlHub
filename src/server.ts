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
 *
 * Worker startup: production runs `dist/worker.js` as a separate service and
 * disables workers here. Development can still start them through the Next.js
 * instrumentation hook for a single-command local environment.
 */
import { createServer } from "node:http";
import next from "next";

import { closeWebSocketServer, setupWebSocketServer } from "@/lib/ws/notification-ws";
import { forwardSshUpgrade } from "@/lib/ws/ssh-upgrade-forwarder";
import { createLogger } from "@/lib/logging";
import { parseTcpPort } from "@/lib/runtime/listen-port";

const logger = createLogger("server");

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
	// Request-abort noise: Playwright (especially WebKit) and some clients drop
	// the connection mid-response after `domcontentloaded`. Next.js throws an
	// `Error: aborted` (and sometimes `ECONNRESET` / `ERR_STREAM_PREMATURE_CLOSE`)
	// up the stack. These are expected client-disconnect signals, not process
	// crashes — exiting on them killed our custom server mid-E2E-suite and was
	// the root cause of the long-standing "connection refused" WebKit failures.
	// Log and continue; genuine crashes will still surface via repeated logs.
	const code = (err as NodeJS.ErrnoException).code;
	const msg = err?.message ?? "";
	if (
		msg === "aborted" ||
		code === "ECONNRESET" ||
		code === "ERR_STREAM_PREMATURE_CLOSE" ||
		code === "EPIPE"
	) {
		logger.warn("Ignored client-disconnect error", { message: msg, code });
		return;
	}
	logger.error("Uncaught exception:", err);
	process.exit(1);
});

const dev = process.env.NODE_ENV !== "production";
// Bind to loopback by default in production; containers can set NEXT_HOST=0.0.0.0.
const hostname = process.env.NEXT_HOST?.trim() || (dev ? "0.0.0.0" : "127.0.0.1");
const port = parseTcpPort(process.env.PORT, 3000, "PORT");

async function main() {
	const app = next({ dev, hostname, port });
	const handle = app.getRequestHandler();

	await app.prepare();

	// Next's own upgrade handler (dev HMR websocket). Passed to the WS layer so
	// upgrades this server does not own (`/_next/webpack-hmr` in dev) reach
	// Next instead of being destroyed.
	// Must be read after prepare(): NextCustomServer throws
	// "prepare() must be called before performing this operation" otherwise,
	// which made the production server exit(1) before it ever bound a port.
	const nextUpgrade = app.getUpgradeHandler();

	// Next.js App Router only dispatches standard HTTP methods. Map WebDAV
	// verbs to POST + X-HTTP-Method-Override so /api/webdav/* can handle them.
	const WEBDAV_OVERRIDE_METHODS = new Set([
		"PROPFIND",
		"PROPPATCH",
		"MKCOL",
		"COPY",
		"MOVE",
		"LOCK",
		"UNLOCK",
	]);

	const server = createServer(async (req, res) => {
		const url = req.url ?? "";
		const method = (req.method ?? "GET").toUpperCase();
		if (url.startsWith("/api/webdav") && WEBDAV_OVERRIDE_METHODS.has(method)) {
			req.headers["x-http-method-override"] = method;
			req.method = "POST";
		}
		// A rejection inside Next's handler is otherwise only logged (the
		// unhandledRejection handler is log-only) and the socket is left
		// dangling until the client times out — destroy it so the connection
		// resolves instead of hanging.
		await handle(req, res).catch((error) => {
			logger.error("Next request handler rejected", error, { url, method });
			if (!res.destroyed) res.destroy();
		});
	});

	// Attach WebSocket notification server (handles /ws upgrade, forwards the
	// rest — e.g. the dev HMR websocket — to Next's upgrade handler).
	setupWebSocketServer(server, {
		onForeignUpgrade: (req, socket, head) => {
			// `/ssh` terminal upgrades belong to the standalone gateway (3001).
			// Pipe them through so compose deployments without a reverse proxy
			// get working terminals; systemd+Caddy deployments keep routing the
			// same path at the proxy layer instead.
			if (forwardSshUpgrade(req, socket, head)) return;
			Promise.resolve(nextUpgrade(req, socket, head)).catch(() => {
				if (!socket.destroyed) socket.destroy();
			});
		},
	});

	server.listen(port, hostname, () => {
		logger.info(`Next.js (${dev ? "dev" : "prod"}) + WS listening on http://${hostname}:${port}`);
	});

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info("HTTP server shutdown started", { signal });
		const forceTimer = setTimeout(() => {
			logger.warn("HTTP server graceful shutdown timed out; closing remaining connections");
			server.closeAllConnections();
			process.exit(0);
		}, 15_000);
		forceTimer.unref();
		// Upgraded WebSocket connections are not managed by server.close().
		// Terminate them first so routine systemd stops can complete cleanly.
		closeWebSocketServer();
		server.close((error) => {
			clearTimeout(forceTimer);
			if (error) {
				logger.error("HTTP server shutdown failed", error);
				process.exit(1);
			}
			logger.info("HTTP server shutdown complete");
			process.exit(0);
		});
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start:", err);
	process.exit(1);
});
