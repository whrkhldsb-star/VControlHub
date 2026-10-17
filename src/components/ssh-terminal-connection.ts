import { decodeBase64Bytes } from "@/components/ssh-terminal-codec";
import { createSshTerminalInputSender } from "@/components/ssh-terminal-input";
import { resetTerminalModes, type TerminalBufferType } from "@/components/ssh-terminal-modes";
import type { TerminalStatus } from "@/components/ssh-terminal-types";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";
import { ApiError } from "@/lib/http/api-client-error";

/**
 * One terminal's connection to the SSH gateway, independent of React.
 *
 * The xterm instance outlives every connection. Each attempt fetches a fresh
 * handshake token and, when keep-alive is on and the gateway announced a
 * resumable shell, asks to continue that shell.
 *
 * - A drop is retried automatically: after 1, 2, 4, 8 s and then every 15 s,
 *   for up to SSH_RECONNECT_WINDOW_MS from the first failure (a deploy that
 *   restarts the gateway fits well within it). A page that becomes visible
 *   again or a network that comes back retries at once (`wake`).
 * - A shell that ended on purpose (`exit`, the idle timeout) and a refusal
 *   that a retry cannot change (permissions, origin, an expired login) wait
 *   for the user instead: retrying would only open an unwanted new shell or
 *   fail again.
 * - When an attempt lands on a NEW shell in a terminal that already showed
 *   one, the terminal's modes are reset first (see ssh-terminal-modes): the
 *   previous program's mouse tracking or alternate screen must not apply to
 *   the new shell. A resumed shell keeps them — its program is still running.
 * - Input is ordered and bounded by createSshTerminalInputSender and never
 *   carried over into another connection.
 */
export const SSH_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
export const SSH_RECONNECT_WINDOW_MS = 3 * 60_000;

type ConnectionTerminal = {
	readonly cols: number;
	readonly rows: number;
	readonly buffer: { readonly active: { readonly type: TerminalBufferType } };
	write(data: string | Uint8Array): void;
};

export type SshSessionInfo = {
	/** The gateway continued the shell from before the drop. */
	resumed: boolean;
	/** This terminal had shown a shell before (false for the first shell). */
	afterReconnect: boolean;
	/** How long the gateway keeps this shell after a drop; 0 when it does not. */
	keepAliveMs: number;
	/** More output arrived while detached than the gateway keeps; only its end was replayed. */
	replayTruncated: boolean;
};

export type SshConnectionState = {
	status: TerminalStatus;
	/** Why the connection is not up; empty while connecting or connected. */
	message: string;
	/** When the next automatic attempt starts; null when none is scheduled. */
	retryAt: number | null;
	/** Ended on purpose or refused for good: only the user starts the next attempt. */
	waitingForUser: boolean;
};

export type SshTerminalConnectionOptions = {
	serverId: string;
	terminal: ConnectionTerminal;
	/** Size the xterm grid to its surface; the connection reports the result to the PTY. */
	fitGrid: () => void;
	keepAlive: () => boolean;
	fetchHandshakeToken: () => Promise<string>;
	location: { protocol: string; host: string };
	t: (key: string) => string;
	onState: (state: SshConnectionState) => void;
	onSession: (info: SshSessionInfo) => void;
	onInputOverflow: () => void;
	createSocket?: (url: string) => WebSocket;
	now?: () => number;
};

export type SshTerminalConnection = {
	start(): void;
	/** User-initiated: try again now, with a fresh retry window. */
	reconnect(): void;
	/** The page became visible or the network came back: retry now if one is due. */
	wake(): void;
	/** Queue keystrokes or a paste for the shell; false when not accepted. */
	send(data: string): boolean;
	/** Report the current grid size to the PTY. */
	resize(): void;
	dispose(): void;
};

const SOCKET_OPEN = 1;

type GatewayMessage = {
	type?: unknown;
	data?: unknown;
	id?: unknown;
	inputAck?: unknown;
	resumeId?: unknown;
	resumed?: unknown;
	keepAliveMs?: unknown;
	replayTruncated?: unknown;
	reason?: unknown;
	fatal?: unknown;
};

export function createSshTerminalConnection(options: SshTerminalConnectionOptions): SshTerminalConnection {
	const { terminal, t } = options;
	const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
	const now = options.now ?? Date.now;

	let disposed = false;
	let attemptId = 0;
	let socket: WebSocket | null = null;
	let sender: ReturnType<typeof createSshTerminalInputSender> | null = null;
	let resumeId: string | null = null;
	let shownShell = false;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let retryIndex = 0;
	let outageStartedAt: number | null = null;
	let waitingForUser = false;
	let state: SshConnectionState = { status: "connecting", message: "", retryAt: null, waitingForUser: false };

	const emit = (next: Partial<SshConnectionState>) => {
		state = { ...state, ...next };
		options.onState(state);
	};

	const clearRetry = () => {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = null;
	};

	/** Forget the current socket without letting its late events reach us. */
	const dropSocket = () => {
		sender?.dispose();
		sender = null;
		const previous = socket;
		socket = null;
		if (!previous) return;
		previous.onopen = null;
		previous.onmessage = null;
		previous.onclose = null;
		previous.onerror = null;
		try { previous.close(); } catch { /* already closed */ }
	};

	const sendResize = (target: WebSocket | null = socket) => {
		if (target?.readyState !== SOCKET_OPEN) return;
		target.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
	};

	/** The attempt is over: wait for the user, or schedule the next try. */
	const settle = (id: number, status: TerminalStatus, message: string) => {
		if (disposed || id !== attemptId) return;
		clearRetry();
		if (waitingForUser) {
			emit({ status, message, retryAt: null, waitingForUser: true });
			return;
		}
		const startedAt = outageStartedAt ?? now();
		outageStartedAt = startedAt;
		if (now() - startedAt >= SSH_RECONNECT_WINDOW_MS) {
			emit({ status, message, retryAt: null, waitingForUser: false });
			return;
		}
		const delay = SSH_RECONNECT_DELAYS_MS[Math.min(retryIndex, SSH_RECONNECT_DELAYS_MS.length - 1)]!;
		retryIndex += 1;
		emit({ status, message, retryAt: now() + delay, waitingForUser: false });
		retryTimer = setTimeout(() => {
			retryTimer = null;
			void attempt();
		}, delay);
	};

	const attempt = async () => {
		clearRetry();
		dropSocket();
		if (disposed) return;
		const id = ++attemptId;
		waitingForUser = false;
		emit({ status: "connecting", message: "", retryAt: null, waitingForUser: false });

		let token = "";
		try {
			token = await options.fetchHandshakeToken();
		} catch (error) {
			if (disposed || id !== attemptId) return;
			// No session any more: retrying cannot help, the user has to sign in.
			if (error instanceof ApiError && (error.status === 401 || error.status === 403)) waitingForUser = true;
			settle(id, "error", t("sshTerminalModal.errTokenFetchFailed"));
			return;
		}
		if (disposed || id !== attemptId) return;
		if (!token) {
			waitingForUser = true;
			settle(id, "error", t("sshTerminalModal.errTokenEmpty"));
			return;
		}

		const keepAlive = options.keepAlive();
		const ws = createSocket(buildSshWebSocketUrl({
			pageProtocol: options.location.protocol,
			host: options.location.host,
			serverId: options.serverId,
			handshakeToken: token,
			keepAlive,
			resumeId: keepAlive ? resumeId : null,
		}));
		socket = ws;
		const wsSender = createSshTerminalInputSender(ws, options.onInputOverflow);
		sender = wsSender;
		let opened = false;
		/** What the gateway said before closing, if anything. */
		let ending: { status: TerminalStatus; message: string } | null = null;

		ws.onopen = () => {
			if (id !== attemptId) return;
			opened = true;
			// The gateway keeps the size for the PTY it is about to open. Stay
			// "connecting" until it confirms the shell: input sent earlier is held.
			sendResize(ws);
		};

		ws.onmessage = (event: MessageEvent) => {
			if (id !== attemptId) return;
			let msg: GatewayMessage;
			try { msg = JSON.parse(String(event.data)) as GatewayMessage; } catch { return; }
			switch (msg.type) {
				case "output":
					if (typeof msg.data === "string" && msg.data) terminal.write(decodeBase64Bytes(msg.data));
					break;
				case "connected":
					wsSender.connected(msg.inputAck === true);
					// The shell exists now: make the PTY match the grid on screen.
					options.fitGrid();
					sendResize(ws);
					retryIndex = 0;
					outageStartedAt = null;
					emit({ status: "connected", message: "", retryAt: null, waitingForUser: false });
					break;
				case "session": {
					resumeId = typeof msg.resumeId === "string" ? msg.resumeId : null;
					const resumed = msg.resumed === true;
					const afterReconnect = shownShell;
					if (afterReconnect && !resumed) {
						resetTerminalModes(terminal);
						terminal.write(`\r\n\u001b[2m${t("sshTerminalModal.sessionFreshLine")}\u001b[0m\r\n`);
					}
					shownShell = true;
					options.onSession({
						resumed,
						afterReconnect,
						keepAliveMs: Number.isFinite(msg.keepAliveMs) ? Number(msg.keepAliveMs) : 0,
						replayTruncated: msg.replayTruncated === true,
					});
					break;
				}
				case "input-ack":
					wsSender.acknowledge(msg.id);
					break;
				case "error":
					ending = { status: "error", message: typeof msg.data === "string" && msg.data ? msg.data : t("sshTerminalModal.errUnknown") };
					if (msg.fatal === true) waitingForUser = true;
					emit({ ...ending, retryAt: null });
					break;
				case "closed":
					ending = { status: "closed", message: typeof msg.data === "string" && msg.data ? msg.data : t("sshTerminalModal.errClosed") };
					// The shell itself ended (exit, logout, idle timeout): a new
					// one is the user's decision, not an automatic retry.
					if (msg.reason === "exit" || msg.reason === "idle") waitingForUser = true;
					emit({ ...ending, retryAt: null });
					break;
			}
		};

		ws.onclose = () => {
			if (id !== attemptId) return;
			wsSender.dispose();
			if (sender === wsSender) sender = null;
			if (socket === ws) socket = null;
			const fallback = opened
				? { status: "closed" as const, message: t("sshTerminalModal.errDisconnected") }
				: { status: "error" as const, message: t("sshTerminalModal.errConnectionFailed") };
			const end = ending ?? fallback;
			settle(id, end.status, end.message);
		};

		// `close` always follows `error`; it decides what happens next.
		ws.onerror = () => undefined;
	};

	return {
		start() {
			if (disposed || attemptId > 0) return;
			void attempt();
		},
		reconnect() {
			if (disposed) return;
			retryIndex = 0;
			outageStartedAt = null;
			waitingForUser = false;
			void attempt();
		},
		wake() {
			if (disposed || waitingForUser || socket || state.status === "connecting" && !retryTimer) return;
			if (state.status === "connected") return;
			// A fresh window: the machine slept or the network was away, which
			// says nothing about how long the gateway has been unreachable.
			retryIndex = 0;
			outageStartedAt = null;
			void attempt();
		},
		send(data: string) {
			return sender?.enqueue(data) ?? false;
		},
		resize() {
			sendResize();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearRetry();
			dropSocket();
		},
	};
}
