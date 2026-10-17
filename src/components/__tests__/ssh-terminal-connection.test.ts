import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	SSH_RECONNECT_DELAYS_MS,
	SSH_RECONNECT_WINDOW_MS,
	createSshTerminalConnection,
	type SshConnectionState,
	type SshSessionInfo,
} from "../ssh-terminal-connection";
import { ApiError } from "@/lib/http/api-client-error";

class FakeSocket {
	static instances: FakeSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	closedByClient = false;
	constructor(public url: string) { FakeSocket.instances.push(this); }
	send(data: string) { this.sent.push(data); }
	close() { this.closedByClient = true; }
	open() { this.readyState = 1; this.onopen?.(); }
	message(payload: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(payload) }); }
	/** The gateway confirms the shell and says whether it is the old one. */
	attach(session: { resumeId?: string | null; resumed?: boolean; keepAliveMs?: number; replayTruncated?: boolean } = {}) {
		this.open();
		this.message({ type: "connected", inputAck: true });
		this.message({ type: "session", resumeId: "shell-1", resumed: false, keepAliveMs: 600_000, ...session });
	}
	drop() { this.readyState = 3; this.onclose?.(); }
}

function setup(overrides: { keepAlive?: boolean; token?: () => Promise<string> } = {}) {
	const writes: string[] = [];
	const terminal = {
		cols: 120,
		rows: 32,
		buffer: { active: { type: "normal" as "normal" | "alternate" } },
		write: vi.fn((data: string | Uint8Array) => { writes.push(typeof data === "string" ? data : new TextDecoder().decode(data)); }),
	};
	const states: SshConnectionState[] = [];
	const sessions: SshSessionInfo[] = [];
	const fitGrid = vi.fn();
	const fetchHandshakeToken = vi.fn(overrides.token ?? (() => Promise.resolve("token")));
	const connection = createSshTerminalConnection({
		serverId: "srv-1",
		terminal,
		fitGrid,
		keepAlive: () => overrides.keepAlive ?? true,
		fetchHandshakeToken,
		location: { protocol: "https:", host: "hub.example.test" },
		t: (key) => key,
		onState: (state) => states.push(state),
		onSession: (info) => sessions.push(info),
		onInputOverflow: vi.fn(),
		createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
	});
	const last = () => states.at(-1)!;
	return { connection, terminal, writes, states, sessions, fitGrid, fetchHandshakeToken, last };
}

/** Let the token promise resolve so the socket gets created. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("SSH terminal connection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("stays connecting until the gateway confirms the shell, then reports the grid", async () => {
		const { connection, last, fitGrid } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		expect(socket.url).toBe("wss://hub.example.test/ssh?serverId=srv-1&handshake=token&keepAlive=1");
		socket.open();
		expect(last().status).toBe("connecting");
		expect(socket.sent).toContain(JSON.stringify({ type: "resize", cols: 120, rows: 32 }));
		socket.message({ type: "connected", inputAck: true });
		expect(last()).toEqual({ status: "connected", message: "", retryAt: null, waitingForUser: false });
		expect(fitGrid).toHaveBeenCalled();
		connection.dispose();
	});

	it("resets the terminal's modes when a reconnect lands on a new shell, and only then", async () => {
		const { connection, writes, sessions } = setup();
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach();
		expect(writes.join("")).not.toContain("\x1b[?1003l");
		expect(sessions.at(-1)).toEqual({ resumed: false, afterReconnect: false, keepAliveMs: 600_000, replayTruncated: false });

		// The shell is kept: the program is still running, its modes stay.
		FakeSocket.instances[0]!.drop();
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_DELAYS_MS[0]);
		expect(FakeSocket.instances[1]!.url).toContain("resume=shell-1");
		FakeSocket.instances[1]!.attach({ resumed: true });
		expect(writes.join("")).not.toContain("\x1b[?1003l");
		expect(sessions.at(-1)).toMatchObject({ resumed: true, afterReconnect: true });

		// The shell is gone: nothing of the old program's state may leak.
		FakeSocket.instances[1]!.drop();
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_DELAYS_MS[0]);
		FakeSocket.instances[2]!.attach({ resumeId: "shell-2", resumed: false });
		const output = writes.join("");
		expect(output).toContain("\x1b[?1003l");
		expect(output).toContain("\x1b[?1006l");
		expect(output).toContain("\x1b[!p");
		expect(output).toContain("sshTerminalModal.sessionFreshLine");
		expect(sessions.at(-1)).toMatchObject({ resumed: false, afterReconnect: true });
		connection.dispose();
	});

	it("leaves the alternate screen when the old program was full screen", async () => {
		const { connection, terminal, writes } = setup();
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach();
		terminal.buffer.active.type = "alternate";
		FakeSocket.instances[0]!.drop();
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_DELAYS_MS[0]);
		FakeSocket.instances[1]!.attach({ resumed: false });
		expect(writes.join("")).toContain("\x1b[?1049l");
		connection.dispose();
	});

	it("retries a drop with growing delays and gives up after the window", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach();
		FakeSocket.instances[0]!.drop();
		expect(last()).toMatchObject({ status: "closed", message: "sshTerminalModal.errDisconnected", waitingForUser: false });
		expect(last().retryAt).toBe(Date.now() + 1_000);

		// The gateway is down: every attempt fails to open.
		let elapsed = 0;
		const delays: number[] = [];
		while (last().retryAt !== null) {
			const delay = last().retryAt! - Date.now();
			delays.push(delay);
			await vi.advanceTimersByTimeAsync(delay);
			elapsed += delay;
			FakeSocket.instances.at(-1)!.drop();
		}
		expect(delays.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
		expect(elapsed).toBeGreaterThanOrEqual(SSH_RECONNECT_WINDOW_MS - 15_000);
		expect(elapsed).toBeLessThan(SSH_RECONNECT_WINDOW_MS + 15_000);
		expect(last()).toMatchObject({ status: "error", message: "sshTerminalModal.errConnectionFailed", retryAt: null, waitingForUser: false });

		// A visible page or a returning network tries again at once.
		const before = FakeSocket.instances.length;
		connection.wake();
		await flush();
		expect(FakeSocket.instances.length).toBe(before + 1);
		connection.dispose();
	});

	it("starts the delays over once a connection succeeds", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach();
		FakeSocket.instances[0]!.drop();
		await vi.advanceTimersByTimeAsync(1_000);
		FakeSocket.instances[1]!.drop();
		expect(last().retryAt! - Date.now()).toBe(2_000);
		await vi.advanceTimersByTimeAsync(2_000);
		FakeSocket.instances[2]!.attach({ resumed: true });
		FakeSocket.instances[2]!.drop();
		expect(last().retryAt! - Date.now()).toBe(1_000);
		connection.dispose();
	});

	it("waits for the user after the shell exits or the idle timeout ends it", async () => {
		for (const reason of ["exit", "idle"]) {
			FakeSocket.instances = [];
			const { connection, last } = setup();
			connection.start();
			await flush();
			const socket = FakeSocket.instances[0]!;
			socket.attach();
			socket.message({ type: "closed", data: "Shell exited", reason });
			socket.drop();
			expect(last()).toEqual({ status: "closed", message: "Shell exited", retryAt: null, waitingForUser: true });
			await vi.advanceTimersByTimeAsync(SSH_RECONNECT_WINDOW_MS);
			connection.wake();
			await flush();
			expect(FakeSocket.instances).toHaveLength(1);

			connection.reconnect();
			await flush();
			expect(FakeSocket.instances).toHaveLength(2);
			expect(last()).toMatchObject({ status: "connecting", waitingForUser: false });
			connection.dispose();
		}
	});

	it("retries a lost SSH connection on its own", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		socket.message({ type: "closed", data: "lost", reason: "lost" });
		socket.drop();
		expect(last()).toMatchObject({ status: "closed", message: "lost", waitingForUser: false });
		expect(last().retryAt).not.toBeNull();
		connection.dispose();
	});

	it("does not retry refusals a retry cannot change", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		socket.open();
		socket.message({ type: "error", data: "denied", fatal: true });
		socket.drop();
		expect(last()).toEqual({ status: "error", message: "denied", retryAt: null, waitingForUser: true });
		connection.dispose();
	});

	it("treats an expired login as final but a failed token request as transient", async () => {
		const expired = setup({ token: () => Promise.reject(new ApiError(401, { error: "unauthorized" })) });
		expired.connection.start();
		await flush();
		expect(expired.last()).toMatchObject({ status: "error", message: "sshTerminalModal.errTokenFetchFailed", waitingForUser: true, retryAt: null });
		expired.connection.dispose();

		const offline = setup({ token: () => Promise.reject(new TypeError("Failed to fetch")) });
		offline.connection.start();
		await flush();
		expect(offline.last()).toMatchObject({ status: "error", waitingForUser: false });
		expect(offline.last().retryAt).not.toBeNull();
		offline.connection.dispose();
	});

	it("never lets a replaced socket's late events through", async () => {
		const { connection, last, writes } = setup();
		connection.start();
		await flush();
		const old = FakeSocket.instances[0]!;
		old.attach();
		connection.reconnect();
		await flush();
		expect(old.closedByClient).toBe(true);
		const outputHandler = old.onmessage;
		expect(outputHandler).toBeNull();
		FakeSocket.instances[1]!.attach({ resumed: true });
		expect(last().status).toBe("connected");
		expect(writes.join("")).not.toContain("sshTerminalModal.sessionFreshLine");
		connection.dispose();
	});

	it("asks for a plain shell, never a resume, when keep-alive is off", async () => {
		const { connection } = setup({ keepAlive: false });
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach({ resumeId: null });
		FakeSocket.instances[0]!.drop();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(FakeSocket.instances[1]!.url).not.toContain("keepAlive");
		expect(FakeSocket.instances[1]!.url).not.toContain("resume=");
		connection.dispose();
	});

	it("holds input until the shell is confirmed and sends it in order", async () => {
		const { connection } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		expect(connection.send("ls\r")).toBe(true);
		socket.open();
		expect(socket.sent.filter((m) => m.includes('"input"'))).toHaveLength(0);
		socket.message({ type: "connected", inputAck: true });
		const inputs = socket.sent.filter((m) => m.includes('"input"')).map((m) => JSON.parse(m) as { data: string });
		expect(inputs.map((m) => atob(m.data))).toEqual(["ls\r"]);
		connection.dispose();
	});

	it("stops retrying once disposed", async () => {
		const { connection } = setup();
		connection.start();
		await flush();
		FakeSocket.instances[0]!.attach();
		FakeSocket.instances[0]!.drop();
		connection.dispose();
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_WINDOW_MS);
		expect(FakeSocket.instances).toHaveLength(1);
	});
});
