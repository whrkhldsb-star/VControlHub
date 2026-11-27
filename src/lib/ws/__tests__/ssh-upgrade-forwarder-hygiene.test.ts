// @vitest-environment node
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeUpstream = EventEmitter & {
	destroyed: boolean;
	write: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	setNoDelay: ReturnType<typeof vi.fn>;
	setTimeout: ReturnType<typeof vi.fn>;
	pipe: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({ upstream: undefined as unknown as FakeUpstream }));

vi.mock("node:net", async (original) => {
	const net = await original<typeof import("node:net")>();
	const { EventEmitter: Emitter } = await import("node:events");
	const connect = () => {
		const upstream = Object.assign(new Emitter(), {
			destroyed: false,
			write: vi.fn(),
			setNoDelay: vi.fn(),
			setTimeout: vi.fn(),
			pipe: vi.fn(),
			destroy: vi.fn(() => {
				if (upstream.destroyed) return;
				upstream.destroyed = true;
				upstream.emit("close");
			}),
		});
		state.upstream = upstream as unknown as FakeUpstream;
		return upstream;
	};
	return { ...net, connect, default: { ...net, connect } };
});

import { createHmac } from "node:crypto";
import { forwardSshUpgrade } from "../ssh-upgrade-forwarder";
import { PEER_SIGNATURE_HEADER } from "../pre-auth-limiter";

function browserSocket() {
	const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
	return Object.assign(socket, { setNoDelay: vi.fn() });
}

function upgradeRequest() {
	return {
		method: "GET",
		url: "/ssh?serverId=s1",
		headers: { host: "hub.test", upgrade: "websocket", "sec-websocket-key": "key==" },
		socket: { remoteAddress: "192.0.2.10" },
	} as unknown as import("node:http").IncomingMessage;
}

describe("ssh upgrade forwarder socket hygiene", () => {
	beforeEach(() => vi.clearAllMocks());

	it("clears the connect timeout once the gateway accepted, so a quiet terminal is not cut", () => {
		const socket = browserSocket();
		forwardSshUpgrade(upgradeRequest(), socket, Buffer.alloc(0), { SSH_WS_PORT: "3001" });
		expect(state.upstream.setTimeout).toHaveBeenCalledWith(5_000, expect.any(Function));
		state.upstream.emit("connect");
		expect(state.upstream.setTimeout).toHaveBeenLastCalledWith(0);
		socket.destroy();
	});

	it("survives repeated errors on either socket instead of throwing an unhandled 'error'", () => {
		const socket = browserSocket();
		forwardSshUpgrade(upgradeRequest(), socket, Buffer.alloc(0), { SSH_WS_PORT: "3001" });
		state.upstream.emit("connect");
		// A one-shot listener left nothing for the second event, which Node throws: the web process died.
		expect(() => {
			state.upstream.emit("error", new Error("ECONNRESET"));
			state.upstream.emit("error", new Error("EPIPE"));
		}).not.toThrow();
		expect(() => {
			socket.emit("error", new Error("ECONNRESET"));
			socket.emit("error", new Error("EPIPE"));
		}).not.toThrow();
		expect(state.upstream.listenerCount("error")).toBeGreaterThan(0);
		expect(socket.listenerCount("error")).toBeGreaterThan(0);
	});

	it("signs the forwarded peer with the trimmed SSH_WS_SECRET, as the gateway verifies it", () => {
		const socket = browserSocket();
		forwardSshUpgrade(upgradeRequest(), socket, Buffer.alloc(0), { SSH_WS_PORT: "3001", SSH_WS_SECRET: "  shared-secret\n" });
		state.upstream.emit("connect");
		const written = String(state.upstream.write.mock.calls[0]?.[0]);
		const expected = createHmac("sha256", "shared-secret").update(JSON.stringify(["192.0.2.10", "key=="])).digest("hex");
		expect(written).toContain(`${PEER_SIGNATURE_HEADER}: ${expected}`);
		socket.destroy();
	});
});
