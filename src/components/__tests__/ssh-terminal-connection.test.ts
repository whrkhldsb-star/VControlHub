import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	SSH_CLOSE_REPLACED,
	SSH_HEARTBEAT_INTERVAL_MS,
	SSH_HEARTBEAT_TIMEOUT_MS,
	SSH_RECONNECT_DELAYS_MS,
	SSH_RECONNECT_WINDOW_MS,
	createSshTerminalConnection,
	type SshConnectionState,
	type SshResumeStore,
	type SshSessionInfo,
} from "../ssh-terminal-connection";
import { ApiError } from "@/lib/http/api-client-error";

class FakeSocket {
	static instances: FakeSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event?: { code: number }) => void) | null = null;
	onerror: (() => void) | null = null;
	closedByClient = false;
	constructor(public url: string) { FakeSocket.instances.push(this); }
	send(data: string) { this.sent.push(data); }
	close() { this.closedByClient = true; }
	open() { this.readyState = 1; this.onopen?.(); }
	message(payload: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(payload) }); }
	/** The gateway confirms the shell and says whether it is the old one. */
	attach(session: { resumeId?: string | null; resumed?: boolean; keepAliveMs?: number; replayTruncated?: boolean; offset?: number } = {}) {
		this.open();
		this.message({ type: "connected", inputAck: true });
		this.message({ type: "session", resumeId: "shell-1", resumed: false, keepAliveMs: 600_000, ...session });
	}
	drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
	/** Messages of one type the terminal sent, parsed. */
	sentOfType(type: string) { return this.sent.map((m) => JSON.parse(m) as Record<string, unknown>).filter((m) => m.type === type); }
}

function setup(overrides: { keepAlive?: boolean; token?: () => Promise<string>; resumeStore?: SshResumeStore } = {}) {
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
		resumeStore: overrides.resumeStore,
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

	it("resumes from the last output byte it received", async () => {
		const { connection } = setup();
		connection.start();
		await flush();
		const first = FakeSocket.instances[0]!;
		first.attach({ offset: 100 });
		first.message({ type: "output", data: btoa("hello") });
		first.drop();
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_DELAYS_MS[0]);
		expect(FakeSocket.instances[1]!.url).toContain("resume=shell-1&offset=105");
		connection.dispose();
	});

	it("treats a socket that stops answering pings as dropped and continues the shell at once", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		const first = FakeSocket.instances[0]!;
		first.open();
		first.message({ type: "connected", inputAck: true, heartbeat: true });
		first.message({ type: "session", resumeId: "shell-1", resumed: false, keepAliveMs: 600_000, offset: 0 });
		await vi.advanceTimersByTimeAsync(SSH_HEARTBEAT_INTERVAL_MS);
		expect(first.sentOfType("ping")).toHaveLength(1);
		// An answer (or any other message) keeps the socket.
		first.message({ type: "pong", id: 1 });
		await vi.advanceTimersByTimeAsync(SSH_HEARTBEAT_INTERVAL_MS + SSH_HEARTBEAT_TIMEOUT_MS - 1);
		expect(FakeSocket.instances).toHaveLength(1);
		// Silence after the next ping: the socket is dead even though it never closed.
		await vi.advanceTimersByTimeAsync(SSH_HEARTBEAT_INTERVAL_MS);
		await flush();
		expect(first.closedByClient).toBe(true);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(FakeSocket.instances[1]!.url).toContain("resume=shell-1&offset=0");
		expect(last().status).toBe("connecting");
		connection.dispose();
	});

	it("does not ping a gateway that does not support it", async () => {
		const { connection } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		await vi.advanceTimersByTimeAsync(SSH_HEARTBEAT_INTERVAL_MS * 3);
		expect(socket.sentOfType("ping")).toHaveLength(0);
		expect(FakeSocket.instances).toHaveLength(1);
		connection.dispose();
	});

	it("checks the socket at once when the page wakes up", async () => {
		const { connection } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		socket.open();
		socket.message({ type: "connected", inputAck: true, heartbeat: true });
		connection.wake();
		expect(socket.sentOfType("ping")).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(SSH_HEARTBEAT_TIMEOUT_MS);
		await flush();
		expect(FakeSocket.instances).toHaveLength(2);
		connection.dispose();
	});

	it("waits for the user when another window took the shell over", async () => {
		const { connection, last } = setup();
		connection.start();
		await flush();
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		socket.drop(SSH_CLOSE_REPLACED);
		expect(last()).toMatchObject({ status: "closed", message: "sshTerminalModal.errReplaced", waitingForUser: true, retryAt: null });
		await vi.advanceTimersByTimeAsync(SSH_RECONNECT_WINDOW_MS);
		expect(FakeSocket.instances).toHaveLength(1);
		// Taking it back is a click away and continues the same shell.
		connection.reconnect();
		await flush();
		expect(FakeSocket.instances[1]!.url).toContain("resume=shell-1");
		connection.dispose();
	});

	it("continues a shell kept across a page reload and forgets it when it ends or is closed", async () => {
		const saved: Array<string | null> = [];
		const store: SshResumeStore = { load: () => "shell-9", save: (id) => { saved.push(id); } };
		const { connection } = setup({ resumeStore: store });
		connection.start();
		await flush();
		// A reloaded page has nothing on screen: offset 0 asks for all the history.
		expect(FakeSocket.instances[0]!.url).toContain("resume=shell-9&offset=0");
		FakeSocket.instances[0]!.attach({ resumeId: "shell-9", resumed: true });
		expect(saved).toEqual(["shell-9"]);
		FakeSocket.instances[0]!.message({ type: "closed", reason: "exit", data: "bye" });
		expect(saved.at(-1)).toBeNull();
		connection.dispose();

		const ended: Array<string | null> = [];
		const second = setup({ resumeStore: { load: () => null, save: (id) => { ended.push(id); } } });
		second.connection.start();
		await flush();
		const socket = FakeSocket.instances.at(-1)!;
		socket.attach({ resumeId: "shell-10" });
		second.connection.end();
		expect(socket.sentOfType("end")).toHaveLength(1);
		expect(socket.closedByClient).toBe(true);
		expect(ended).toEqual(["shell-10", null]);
	});
});

describe("stray mouse tracking", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeSocket.instances = [];
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function setupWithModes(mode: string) {
		const writes: string[] = [];
		const terminal = {
			cols: 80,
			rows: 24,
			buffer: { active: { type: "normal" as const } },
			modes: { mouseTrackingMode: mode },
			write: vi.fn((data: string | Uint8Array) => { writes.push(typeof data === "string" ? data : new TextDecoder().decode(data)); }),
		};
		const onStrayMouseTracking = vi.fn();
		const connection = createSshTerminalConnection({
			serverId: "srv-1",
			terminal,
			fitGrid: vi.fn(),
			keepAlive: () => true,
			fetchHandshakeToken: () => Promise.resolve("token"),
			location: { protocol: "https:", host: "hub.example.test" },
			t: (key) => key,
			onState: vi.fn(),
			onSession: vi.fn(),
			onInputOverflow: vi.fn(),
			onStrayMouseTracking,
			createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
		});
		return { connection, writes, onStrayMouseTracking };
	}

	it("switches mouse tracking off when the shell echoes a report it was sent", async () => {
		const { connection, writes, onStrayMouseTracking } = setupWithModes("any");
		connection.start();
		await vi.advanceTimersByTimeAsync(0);
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		connection.send("\x1b[<35;12;5M");
		// A plain shell prints it back, split across two packets.
		socket.message({ type: "output", data: btoa("^[[<35;1") });
		socket.message({ type: "output", data: btoa("2;5M") });
		expect(writes.join("")).toContain("\x1b[?1003l");
		expect(onStrayMouseTracking).toHaveBeenCalledTimes(1);
		connection.dispose();
	});

	it("leaves a program that consumes reports alone, and ignores look-alike colours", async () => {
		const { connection, writes, onStrayMouseTracking } = setupWithModes("any");
		connection.start();
		await vi.advanceTimersByTimeAsync(0);
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		connection.send("\x1b[<35;12;5M");
		socket.message({ type: "output", data: btoa("\x1b[38;5;196mredraw\x1b[0m\x1b[12;5H") });
		// Too late to be an echo of that report.
		await vi.advanceTimersByTimeAsync(5_000);
		socket.message({ type: "output", data: btoa("35;12;5M") });
		expect(writes.join("")).not.toContain("\x1b[?1003l");
		expect(onStrayMouseTracking).not.toHaveBeenCalled();
		connection.dispose();
	});

	it("does nothing while mouse tracking is off", async () => {
		const { connection, onStrayMouseTracking } = setupWithModes("none");
		connection.start();
		await vi.advanceTimersByTimeAsync(0);
		const socket = FakeSocket.instances[0]!;
		socket.attach();
		connection.send("\x1b[<35;12;5M");
		socket.message({ type: "output", data: btoa("35;12;5M") });
		expect(onStrayMouseTracking).not.toHaveBeenCalled();
		connection.dispose();
	});
});
