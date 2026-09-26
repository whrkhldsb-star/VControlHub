import { createServer, type Server } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	forwardSshUpgrade,
	isSshGatewayForwardingEnabled,
	isSshUpgradePath,
} from "../ssh-upgrade-forwarder";

type FakeSocket = Duplex & { setNoDelay: (v: boolean) => void };

/**
 * A duplex standing in for the browser-side socket. The forwarder's
 * `socket.write(x)` is "data delivered to the browser" (captured in
 * `received`); `socket.push(x)` simulates the browser sending data upstream.
 */
function makeFakeSocket(): { socket: FakeSocket; received: string[] } {
	const received: string[] = [];
	const socket = new Duplex({
		read() {},
		write(chunk, _enc, cb) {
			received.push(String(chunk));
			cb();
		},
		final(cb) {
			cb();
		},
	}) as FakeSocket;
	socket.setNoDelay = () => {};
	return { socket, received };
}

function makeRequest(url: string) {
	return {
		method: "GET",
		url,
		headers: {
			host: "app.example:3000",
			upgrade: "websocket",
			cookie: "vcontrolhub_session=abc",
			"sec-websocket-key": "key==",
		},
	} as unknown as import("node:http").IncomingMessage;
}

describe("ssh upgrade forwarder", () => {
	let gateway: Server;
	let gatewayPort: number;
	const gatewayReceived: string[] = [];

	beforeEach(async () => {
		gatewayReceived.length = 0;
		gateway = createServer((socket) => {
			socket.on("data", (chunk) => {
				gatewayReceived.push(String(chunk));
				// Respond 101 once the upgrade request lands, then echo.
				if (String(chunk).startsWith("GET /ssh")) {
					socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
				} else {
					socket.write(`echo:${String(chunk)}`);
				}
			});
		});
		await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
		const addr = gateway.address();
		gatewayPort = typeof addr === "object" && addr ? addr.port : 0;
	});

	afterEach(() => {
		// Forwarded sockets keep the gateway connection open; the tests destroy
		// their fake client, and unref() keeps any residual handle from blocking
		// the vitest worker.
		gateway.close();
		gateway.unref();
	});

	it("classifies /ssh upgrade paths", () => {
		expect(isSshUpgradePath("/ssh?serverId=s1")).toBe(true);
		expect(isSshUpgradePath("/ssh/extra")).toBe(true);
		expect(isSshUpgradePath("/ws")).toBe(false);
		expect(isSshUpgradePath("/sshx")).toBe(false);
	});

	it("honors the SSH_GATEWAY_FORWARD=0 opt-out", () => {
		expect(isSshGatewayForwardingEnabled({ SSH_GATEWAY_FORWARD: "0" })).toBe(false);
		expect(isSshGatewayForwardingEnabled({ SSH_GATEWAY_FORWARD: "false" })).toBe(false);
		expect(isSshGatewayForwardingEnabled({})).toBe(true);
		expect(
			forwardSshUpgrade(makeRequest("/ssh?x=1"), makeFakeSocket().socket, Buffer.alloc(0), {
				SSH_GATEWAY_FORWARD: "0",
			}),
		).toBe(false);
	});

	it("pipes the upgrade to the gateway with the original request line and headers", async () => {
		const { socket: client, received } = makeFakeSocket();
		const forwarded = forwardSshUpgrade(
			makeRequest("/ssh?serverId=s1&handshake=tok"),
			client,
			Buffer.alloc(0),
			{ SSH_WS_PORT: String(gatewayPort) },
		);
		expect(forwarded).toBe(true);

		await new Promise((r) => setTimeout(r, 50));
		const requestLine = gatewayReceived.find((chunk) => chunk.startsWith("GET /ssh"));
		expect(requestLine).toBeDefined();
		expect(requestLine ?? "").toContain("GET /ssh?serverId=s1&handshake=tok HTTP/1.1");
		expect(requestLine ?? "").toContain("cookie: vcontrolhub_session=abc");
		expect((requestLine ?? "").toLowerCase()).toContain("connection: upgrade");

		// Mock gateway accepts the upgrade and streams a payload: both must be
		// delivered to the browser through the forwarded pipe.
		client.on("data", () => {}); // start flowing so browser pushes reach the gateway
		// The mock gateway writes 101 after seeing the upgrade request; push a
		// follow-up frame from the browser side and verify the round trip.
		client.push("ping-from-browser");
		await new Promise((r) => setTimeout(r, 50));
		expect(gatewayReceived.join("")).toContain("ping-from-browser");
		// The mock gateway echoes unknown payloads back — the browser receives it.
		expect(received.join("")).toContain("echo:ping-from-browser");
		client.destroy();
	});

	it("answers 502 when the gateway is unreachable", async () => {
		// Grab a port that is now closed.
		const closed = createServer();
		await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
		const deadPort = (closed.address() as { port: number }).port;
		await new Promise<void>((resolve) => closed.close(() => resolve()));

		const { socket: client, received } = makeFakeSocket();
		const forwarded = forwardSshUpgrade(
			makeRequest("/ssh?serverId=s1"),
			client,
			Buffer.alloc(0),
			{ SSH_WS_PORT: String(deadPort) },
		);
		expect(forwarded).toBe(true);
		await new Promise((r) => setTimeout(r, 150));
		expect(received.join("")).toContain("502 Bad Gateway");
	});
});
