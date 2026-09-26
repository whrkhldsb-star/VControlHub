/**
 * L4 WebSocket-upgrade forwarder for the SSH terminal gateway.
 *
 * The browser terminal connects to `ws(s)://<page-host>/ssh?…`. The SSH
 * session itself lives in the standalone gateway process (`ssh-ws-proxy`,
 * port 3001 — see deploy/systemd/vcontrolhub-ssh-ws.service.example and the
 * Caddyfile `reverse_proxy /ssh 127.0.0.1:3001` route). The reverse proxy is
 * what makes the same-origin URL work in the systemd topology.
 *
 * The docker-compose topology publishes 3000/3001 directly and ships no
 * reverse-proxy container, so before this forwarder the `/ssh` upgrade hit
 * the Next.js server, which does not own that path and destroyed the socket —
 * terminals were unusable in compose deployments. When the gateway is
 * unreachable the upgrade is answered 502 instead of hanging.
 *
 * This module proxies the raw TCP upgrade bytes to the gateway: it holds no
 * SSH state, so a web-tier restart still drops the browser socket but never
 * the gateway's server-side session.
 */
import { connect } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { createLogger } from "@/lib/logging";
import { parseTcpPort } from "@/lib/runtime/listen-port";

const logger = createLogger("ssh-upgrade-forwarder");

/** Loose env-map signature so callers (and tests) can pass partial overrides. */
type EnvLike = Record<string, string | undefined>;

export function sshGatewayPort(env: EnvLike = process.env): number {
	return parseTcpPort(env.SSH_WS_PORT, 3001, "SSH_WS_PORT");
}

/**
 * Split-host deployments run the gateway on a different machine than the web
 * tier; setting SSH_GATEWAY_FORWARD=0 (or off/false) opts the web process out
 * of the in-process forward so its own 404/proxy chain stays in charge.
 */
export function isSshGatewayForwardingEnabled(env: EnvLike = process.env): boolean {
	const flag = env.SSH_GATEWAY_FORWARD?.trim().toLowerCase();
	return flag !== "0" && flag !== "off" && flag !== "false";
}

export function isSshUpgradePath(rawUrl: string | undefined): boolean {
	let pathname = "/";
	try {
		pathname = new URL(rawUrl || "/", "http://localhost").pathname;
	} catch {
		return false;
	}
	return pathname === "/ssh" || pathname.startsWith("/ssh/");
}

/**
 * Handle a `/ssh` upgrade by piping the raw socket to the gateway. Returns
 * true when the upgrade was forwarded; false lets the caller fall through
 * (disabled via SSH_GATEWAY_FORWARD=0, or a non-/ssh path).
 */
export function forwardSshUpgrade(
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	env: EnvLike = process.env,
): boolean {
	if (!isSshUpgradePath(request.url)) return false;
	if (!isSshGatewayForwardingEnabled(env)) return false;

	const port = sshGatewayPort(env);

	const upstream = connect({ port, host: "127.0.0.1" });
	let settled = false;

	const fail = (logMessage: string, detail?: Error) => {
		if (settled) return;
		settled = true;
		logger.warn(logMessage, detail ? { error: detail.message, port } : { port });
		if (!socket.destroyed) {
			socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
			socket.destroy();
		}
		upstream.destroy();
	};

	upstream.setTimeout(5_000, () => fail("SSH gateway connect timed out"));
	upstream.once("error", (error: Error) => fail("SSH gateway connection failed", error));
	upstream.once("connect", () => {
		if (settled) return;
		settled = true;
		logger.debug("Forwarded /ssh upgrade to gateway", { port });
		// Replay the original upgrade request verbatim — headers, session cookie
		// and handshake query are exactly what the gateway authenticates on.
		upstream.write(
			`${request.method ?? "GET"} ${request.url} HTTP/1.1\r\n` +
			Object.entries(request.headers)
				.filter(([name]) => name.toLowerCase() !== "connection")
				.map(([name, value]) => `${name}: ${value}`)
				.join("\r\n") +
			"\r\nConnection: Upgrade\r\n\r\n",
		);
		if (head.length > 0) upstream.write(head);
		(socket as import("node:net").Socket).setNoDelay?.(true);
		upstream.setNoDelay(true);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});

	const teardown = (side: import("node:net").Socket | Duplex, other: import("node:net").Socket | Duplex) => {
		if (!other.destroyed) other.destroy();
		if (!side.destroyed) side.destroy();
	};
	socket.once("close", () => teardown(socket, upstream));
	upstream.once("close", () => teardown(upstream, socket));
	socket.once("error", () => teardown(socket, upstream));
	return true;
}
