// @vitest-environment node
import { createServer } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifySessionTokenMock } = vi.hoisted(() => ({ verifySessionTokenMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getSessionCookieName: () => "test_session",
	verifySessionToken: verifySessionTokenMock,
}));

import {
	closeWebSocketServer,
	getWsServer,
	setupWebSocketServer,
	broadcastToUser,
} from "../notification-ws";

const servers: ReturnType<typeof createServer>[] = [];
async function listen() {
	const server = createServer((_request, response) => response.end("ready"));
	servers.push(server);
	setupWebSocketServer(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("TCP listener required");
	return { server, port: address.port };
}

describe("notification WebSocket lifecycle", () => {
	beforeEach(() => { verifySessionTokenMock.mockReset().mockResolvedValue({ userId: "user-1" }); });
	afterEach(async () => {
		closeWebSocketServer();
		await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
	});

	it("clears the shared server instance during shutdown", () => {
		const server = createServer();
		setupWebSocketServer(server);

		expect(getWsServer()).not.toBeNull();
		closeWebSocketServer();
		expect(getWsServer()).toBeNull();
	});

	it("detaches upgrades on shutdown and attaches only one handler after reinitialization", () => {
		const server = createServer();
		setupWebSocketServer(server);
		expect(server.listenerCount("upgrade")).toBe(1);
		closeWebSocketServer();
		expect(server.listenerCount("upgrade")).toBe(0);
		setupWebSocketServer(server);
		expect(server.listenerCount("upgrade")).toBe(1);
	});

	it("rejects a malformed upgrade URL without disrupting the HTTP listener", async () => {
		const { port } = await listen();
		const socket = connect(port, "127.0.0.1");
		await once(socket, "connect");
		let response = "";
		socket.on("data", (data) => { response += data.toString(); });
		const closed = once(socket, "close");
		socket.write("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
		await closed;
		expect(response).toContain("400 Bad Request");
		expect(verifySessionTokenMock).not.toHaveBeenCalled();
		expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe("ready");
	});

	it("does not complete an in-flight authentication against a replacement WebSocket server", async () => {
		const { server, port } = await listen();
		let finish!: (value: unknown) => void;
		verifySessionTokenMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
		const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: "test_session=valid" } });
		client.on("error", () => {});
		const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
		await vi.waitFor(() => expect(verifySessionTokenMock).toHaveBeenCalled());
		closeWebSocketServer();
		setupWebSocketServer(server);
		const onConnection = vi.fn();
		getWsServer()!.on("connection", onConnection);
		finish({ userId: "user-1" });
		await closed;
		expect(onConnection).not.toHaveBeenCalled();
	});

	it("rejects upgrades that try to authenticate via the query string", async () => {
		const { port } = await listen();
		const client = new WebSocket(`ws://127.0.0.1:${port}/ws?token=valid`);
		client.on("error", () => {});
		const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
		await closed;
		// The token-in-URL fallback is gone: the credential must ride the
		// HttpOnly cookie, where proxies/logs/Referer cannot capture it.
		expect(verifySessionTokenMock).not.toHaveBeenCalled();
	});

	it("authenticates, responds to heartbeats, broadcasts and releases the connection", async () => {
		const { port } = await listen();
		const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: "test_session=valid" } });
		const first = await once(client, "message");
		expect(JSON.parse(first[0].toString())).toMatchObject({ type: "connected", userId: "user-1" });
		const pong = once(client, "message");
		client.send(JSON.stringify({ type: "ping" }));
		expect(JSON.parse((await pong)[0].toString())).toMatchObject({ type: "pong" });
		const broadcast = once(client, "message");
		broadcastToUser("user-1", { type: "unread_count", count: 2 });
		expect(JSON.parse((await broadcast)[0].toString())).toEqual({ type: "unread_count", count: 2 });
		const closed = once(client, "close");
		client.close();
		await closed;
		await vi.waitFor(() => expect(getWsServer()!.clients.size).toBe(0));
	});

	it("closes an oversized incoming message with code 1009", async () => {
		const { port } = await listen();
		const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: "test_session=valid" } });
		await once(client, "message");
		const closed = once(client, "close");
		client.send("x".repeat(16 * 1024 + 1));
		expect((await closed)[0]).toBe(1009);
	});
});
