"use client";

import { decodeBase64Bytes } from "@/components/ssh-terminal-codec";
import { createSshTerminalInputSender } from "@/components/ssh-terminal-input";
import { installSshTerminalIme } from "@/components/ssh-terminal-ime";
import { installSshTerminalTouchScroll } from "@/components/ssh-terminal-touch-scroll";
import { parseQuickKeyPresets, quickKeyPresetsToEntries, serializeQuickKeyPresets, type QuickKeyPreset } from "@/components/ssh-quick-keys";
import {
	SSH_TERMINAL_FONT_SIZE_KEY,
	clampSshTerminalFontSize,
	parseSshTerminalFontSize,
	readSshTerminalFontSize,
} from "@/components/ssh-terminal-font-size";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";
import { useI18n } from "@/lib/i18n/use-locale";
import { SshFileManager } from "@/components/ssh-file-manager";
import { SshTerminalSidePanel } from "@/components/ssh-terminal-side-panel";
import { SshTerminalSearchBar, SshTerminalToolbar } from "@/components/ssh-terminal-chrome";
import type { TerminalStatus } from "@/components/ssh-terminal-types";
import { writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";
import { AlertTriangle } from "@/components/icons";
import { cn } from "@/lib/ui/cn";
export type { TerminalStatus } from "@/components/ssh-terminal-types";

const FAVORITE_COMMANDS_KEY = "ssh-favorite-commands";
const QUICK_KEY_PRESETS_KEY = "ssh-quick-key-presets";
const MAX_AUTO_RECONNECT_ATTEMPTS = 5;
const AUTO_RECONNECT_BASE_DELAY_MS = 1_000;

function readFavoriteCommands(storage: Storage): string | null {
	return storage.getItem(FAVORITE_COMMANDS_KEY);
}

function readQuickKeyPresets(storage: Storage): string | null {
	return storage.getItem(QUICK_KEY_PRESETS_KEY);
}

function parseFavoriteCommands(raw: string | null): string[] {
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------------ */
/* SshTerminalPanel — single-tab terminal logic (extracted from modal) */
/* ------------------------------------------------------------------ */


export type SshTerminalPanelProps = {
	serverId: string;
	serverName: string;
	host: string;
	/** When false, the panel is hidden via CSS but keeps its WS + terminal alive. */
	visible: boolean;
	/** Called when the user clicks the close button on this tab. */
	onClose: () => void;
	/** Called when connection status changes (for tab badge display). */
	onStatusChange?: (status: TerminalStatus) => void;
	/** Full screen: the terminal fills the viewport, chrome shrinks to a strip. */
	fullscreen?: boolean;
	/** Absent when the host offers no full-screen mode. */
	onToggleFullscreen?: () => void;
};

export function SshTerminalPanel({
	serverId,
	serverName,
	host,
	visible,
	onClose,
	onStatusChange,
	fullscreen = false,
	onToggleFullscreen,
}: SshTerminalPanelProps) {
	const { t } = useI18n();
	// Keep the translator reachable from async WS callbacks without adding `t`
	// to the connection effect deps — a locale switch must NOT tear down live
	// terminals (WebSocket + xterm lifecycle depends on [serverId, reconnectKey]).
	const tRef = useRef(t);
	useEffect(() => { tRef.current = t; }, [t]);
	const termRef = useRef<HTMLDivElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const inputSenderRef = useRef<ReturnType<typeof createSshTerminalInputSender> | null>(null);
	const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const searchAddonRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
	const currentCommandRef = useRef("");
	const connectionNonceRef = useRef(0);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectAttemptsRef = useRef(0);

	const [status, setStatus] = useState<TerminalStatus>("connecting");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [inputError, setInputError] = useState<string>("");
	const [reconnectKey, setReconnectKey] = useState(0);
	const [showSidePanel, setShowSidePanel] = useState(false);
	const [showFileManager, setShowFileManager] = useState(false);
	const [terminalSearch, setTerminalSearch] = useState("");
	const [commandHistory, setCommandHistory] = useState<string[]>([]);
	const storedFavoriteCommands = useBrowserStorageSnapshot(FAVORITE_COMMANDS_KEY, readFavoriteCommands, null);
	const favoriteCommands = useMemo(() => parseFavoriteCommands(storedFavoriteCommands), [storedFavoriteCommands]);
	const [newFavorite, setNewFavorite] = useState("");
	const storedQuickKeyPresets = useBrowserStorageSnapshot(QUICK_KEY_PRESETS_KEY, readQuickKeyPresets, null);
	const quickKeyPresets = useMemo(() => parseQuickKeyPresets(storedQuickKeyPresets), [storedQuickKeyPresets]);
	const customQuickKeys = useMemo(
		() => (quickKeyPresets ? quickKeyPresetsToEntries(quickKeyPresets) : null),
		[quickKeyPresets],
	);

	const storedFontSize = useBrowserStorageSnapshot(SSH_TERMINAL_FONT_SIZE_KEY, readSshTerminalFontSize, null);
	const fontSize = parseSshTerminalFontSize(storedFontSize);
	// Read by the connection effect when it builds the terminal, without
	// making the font size a reason to reconnect.
	const fontSizeRef = useRef(fontSize);

	// Notify parent of status changes
	useEffect(() => {
		onStatusChange?.(status);
	}, [status, onStatusChange]);

	/** Size the grid to the surface and tell the remote PTY; a no-op before the terminal exists. */
	const fitTerminal = useCallback(() => {
		const term = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;
		try {
			fitAddon.fit();
		} catch {
			return;
		}
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
		}
	}, []);

	// Refit terminal when tab becomes visible (xterm needs visible DOM to fit)
	useEffect(() => {
		if (!visible) return;
		// Small delay to ensure DOM is visible before fit
		const timer = setTimeout(fitTerminal, 50);
		return () => clearTimeout(timer);
	}, [visible, fitTerminal]);

	// A new font size changes the cell size, so the grid must be measured again.
	useEffect(() => {
		fontSizeRef.current = fontSize;
		const term = terminalRef.current;
		if (!term || term.options.fontSize === fontSize) return;
		term.options.fontSize = fontSize;
		fitTerminal();
	}, [fontSize, fitTerminal]);

	function disposeConnection() {
		connectionNonceRef.current += 1;
		inputSenderRef.current?.dispose();
		inputSenderRef.current = null;
		if (wsRef.current) {
			try { wsRef.current.close(); } catch {}
			wsRef.current = null;
		}
		if (terminalRef.current) {
			try { terminalRef.current.dispose(); } catch {}
			terminalRef.current = null;
		}
		fitAddonRef.current = null;
		searchAddonRef.current = null;
	}

	useEffect(() => () => {
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (!termRef.current) return;

		let disposed = false;
		const nonce = connectionNonceRef.current;

		const scheduleReconnect = () => {
			if (
				disposed
				|| nonce !== connectionNonceRef.current
				|| reconnectTimerRef.current
				|| reconnectAttemptsRef.current >= MAX_AUTO_RECONNECT_ATTEMPTS
			) return;
			const attempt = reconnectAttemptsRef.current;
			reconnectAttemptsRef.current += 1;
			const delay = AUTO_RECONNECT_BASE_DELAY_MS * 2 ** attempt;
			reconnectTimerRef.current = setTimeout(() => {
				reconnectTimerRef.current = null;
				if (disposed || nonce !== connectionNonceRef.current) return;
				setStatus("connecting");
				setReconnectKey((previous) => previous + 1);
			}, delay);
		};

		async function init() {
			const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
				import("@xterm/addon-search"),
			]);
			await import("@xterm/xterm/css/xterm.css");

			if (disposed || nonce !== connectionNonceRef.current || !termRef.current) return;

			let handshakeToken = "";
			try {
				const data = await csrfFetch("/api/auth/ws-token", {
					method: "POST",
					body: JSON.stringify({ serverId }),
				});
				handshakeToken = data.token || "";
			} catch {
				// Token fetch failed — surface the error to the user and abort the connection.
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(tRef.current("sshTerminalModal.errTokenFetchFailed"));
				}
				return;
			}

			if (!handshakeToken) {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(tRef.current("sshTerminalModal.errTokenEmpty"));
				}
				return;
			}

			if (disposed || nonce !== connectionNonceRef.current || !termRef.current) return;

			const term = new Terminal({
				cursorBlink: true,
				fontSize: fontSizeRef.current,
				fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
				theme: {
					background: "#0a0e1a",
					foreground: "#e2e8f0",
					cursor: "#22d3ee",
					cursorAccent: "#0a0e1a",
					selectionBackground: "#164e63",
					black: "#1e293b",
					red: "#f87171",
					green: "#4ade80",
					yellow: "#facc15",
					blue: "#60a5fa",
					magenta: "#c084fc",
					cyan: "#22d3ee",
					white: "#e2e8f0",
					brightBlack: "#475569",
					brightRed: "#fca5a5",
					brightGreen: "#86efac",
					brightYellow: "#fde68a",
					brightBlue: "#93c5fd",
					brightMagenta: "#d8b4fe",
					brightCyan: "#67e8f9",
					brightWhite: "#f8fafc",
				},
				allowProposedApi: true,
			});

			const fitAddon = new FitAddon();
			const searchAddon = new SearchAddon();
			term.loadAddon(fitAddon);
			term.loadAddon(searchAddon);
			term.open(termRef.current);
			const removeIme = installSshTerminalIme(term);
			fitAddon.fit();

			terminalRef.current = term;
			fitAddonRef.current = fitAddon;
			searchAddonRef.current = searchAddon;

			const removeTouchScroll = installSshTerminalTouchScroll(term, termRef.current);

			const finalWsUrl = buildSshWebSocketUrl({
				pageProtocol: window.location.protocol,
				host: window.location.host,
				serverId,
				handshakeToken,
			});
			const ws = new WebSocket(finalWsUrl);
			wsRef.current = ws;
			const inputSender = createSshTerminalInputSender(ws, () => {
				if (!disposed && nonce === connectionNonceRef.current) setInputError(tRef.current("sshTerminalModal.errInputTooLarge"));
			});
			inputSenderRef.current = inputSender;

			ws.onopen = () => {
				// The browser transport being open does not mean the proxy has
				// finished SSH authentication. Keep the UI in "connecting" until
				// the proxy emits its explicit connected handshake; otherwise a
				// command clicked in this window can be silently dropped.
				ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
			};

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data);
					if (msg.type === "output" && msg.data) {
						term.write(decodeBase64Bytes(msg.data));
					} else if (msg.type === "connected") {
						inputSender.connected(msg.inputAck === true);
						reconnectAttemptsRef.current = 0;
						if (!disposed && nonce === connectionNonceRef.current) setStatus("connected");
					} else if (msg.type === "input-ack") {
						inputSender.acknowledge(msg.id);
					} else if (msg.type === "error") {
						if (!disposed && nonce === connectionNonceRef.current) {
							setStatus("error");
							setErrorMsg(msg.data || tRef.current("sshTerminalModal.errUnknown"));
						}
					} else if (msg.type === "closed") {
						if (!disposed && nonce === connectionNonceRef.current) {
							setStatus("closed");
							setErrorMsg(msg.data || tRef.current("sshTerminalModal.errClosed"));
						}
					}
				} catch {}
			};

			ws.onclose = () => {
				inputSender.dispose();
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("closed");
					setErrorMsg(tRef.current("sshTerminalModal.errDisconnected"));
					scheduleReconnect();
				}
			};

			ws.onerror = () => {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(tRef.current("sshTerminalModal.errConnectionFailed"));
				}
			};

			term.onData((data: string) => {
				if (!inputSender.enqueue(data)) return;
				setInputError("");
				if (data === "\r" || data === "\n") {
					const cmd = currentCommandRef.current.trim();
					currentCommandRef.current = "";
					if (cmd) {
						setCommandHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50));
					}
				} else if (data === "\u007f" || data === "\b") {
					currentCommandRef.current = currentCommandRef.current.slice(0, -1);
				} else if (!data.startsWith("\u001b") && data >= " ") {
					currentCommandRef.current += data;
				}
			});

			// The surface changes size with the window, the mobile drag handle,
			// full screen, the side panel and the on-screen keyboard. Observe the
			// element itself where the browser allows, one measurement per frame;
			// a hidden tab (0 × 0) waits for the `visible` refit instead.
			const surface = termRef.current;
			let pendingFrame = 0;
			const refitSurface = () => {
				if (pendingFrame) return;
				pendingFrame = requestAnimationFrame(() => {
					pendingFrame = 0;
					if (surface.clientHeight > 0) fitTerminal();
				});
			};
			const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refitSurface) : null;
			if (observer) observer.observe(surface);
			else window.addEventListener("resize", refitSurface);
			return () => {
				removeIme();
				removeTouchScroll();
				observer?.disconnect();
				window.removeEventListener("resize", refitSurface);
				if (pendingFrame) cancelAnimationFrame(pendingFrame);
			};
		}

		let removeListeners: (() => void) | undefined;
		void init().then((cleanup) => { removeListeners = cleanup; });

		return () => {
			disposed = true;
			inputSenderRef.current?.dispose();
			inputSenderRef.current = null;
			if (removeListeners) removeListeners();
			if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
			if (terminalRef.current) { try { terminalRef.current.dispose(); } catch {} terminalRef.current = null; }
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
	}, [serverId, reconnectKey, fitTerminal]);

	const changeFontSize = (size: number) => {
		writeLocalStorageValue(SSH_TERMINAL_FONT_SIZE_KEY, String(clampSshTerminalFontSize(size)));
	};

	const saveFavorites = (items: string[]) => {
		writeLocalStorageValue(FAVORITE_COMMANDS_KEY, JSON.stringify(items));
	};

	const addFavorite = () => {
		const cmd = newFavorite.trim();
		if (!cmd || favoriteCommands.includes(cmd)) return;
		const next = [...favoriteCommands, cmd];
		saveFavorites(next);
		setNewFavorite("");
	};

	const removeFavorite = (cmd: string) => {
		const next = favoriteCommands.filter((c) => c !== cmd);
		saveFavorites(next);
	};

	const addQuickKeyPreset = (preset: QuickKeyPreset) => {
		const current = quickKeyPresets ?? [];
		if (current.some((p) => p.label === preset.label)) return;
		const next = [...current, preset];
		writeLocalStorageValue(QUICK_KEY_PRESETS_KEY, serializeQuickKeyPresets(next));
	};

	const resetQuickKeyPresets = () => {
		writeLocalStorageValue(QUICK_KEY_PRESETS_KEY, serializeQuickKeyPresets([]));
	};

	const sendCommand = (cmd: string) => {
		if (inputSenderRef.current?.enqueue(cmd + "\r")) setInputError("");
	};

	/** Send raw key sequences (Ctrl+C, arrows, …) without appending Enter. */
	const sendKeys = (data: string) => {
		if (inputSenderRef.current?.enqueue(data)) setInputError("");
		// Keys that rewrite or discard the pending input line invalidate the
		// tracked current command; keep the panel's history accurate for them.
		if (data === "\u0003" || data === "\u0015" || data === "\u001b[A" || data === "\u001b[B") {
			currentCommandRef.current = "";
		}
	};

	const searchTerminal = (direction: "next" | "previous" = "next") => {
		const query = terminalSearch.trim();
		if (!query || !searchAddonRef.current) return;
		if (direction === "previous") { searchAddonRef.current.findPrevious(query); }
		else { searchAddonRef.current.findNext(query); }
	};

	const clearTerminalSearch = () => {
		setTerminalSearch("");
		searchAddonRef.current?.clearDecorations();
	};

	const handleReconnect = () => {
		disposeConnection();
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		reconnectAttemptsRef.current = 0;
		setStatus("connecting");
		setErrorMsg("");
		setInputError("");
		setReconnectKey((prev) => prev + 1);
	};

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			style={{ display: visible ? "flex" : "none" }}
			data-testid={`ssh-terminal-panel-${serverId}`}
		>
			<SshTerminalToolbar
				serverName={serverName}
				host={host}
				status={status}
				t={t}
				showSidePanel={showSidePanel}
				showFileManager={showFileManager}
				fullscreen={fullscreen}
				onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
				onToggleFileManager={() => setShowFileManager(!showFileManager)}
				onToggleFullscreen={onToggleFullscreen}
				onReconnect={handleReconnect}
				onClose={onClose}
			/>

			{/* Error banner */}
			{errorMsg && (status === "error" || status === "closed") && (
				<div data-tone="rose" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm text-[var(--danger)]">
					<AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
					<span>{errorMsg}</span>
				</div>
			)}

			{/* Terminal + side panel */}
			{inputError && <p role="alert" className="mx-4 mt-3 text-sm text-[var(--danger)]">{inputError}</p>}
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:flex-row lg:overflow-hidden",
					fullscreen ? "gap-2 p-1" : "gap-3 p-3",
				)}
			>
				<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
					{/* Full screen gives the search bar's rows to the terminal. */}
					{!fullscreen && (
						<SshTerminalSearchBar
							serverId={serverId}
							t={t}
							terminalSearch={terminalSearch}
							onSearchChange={setTerminalSearch}
							onSearch={searchTerminal}
							onClear={clearTerminalSearch}
						/>
					)}
					<div
						ref={termRef}
						data-testid="ssh-terminal-surface"
						className={cn(
							"min-h-[280px] min-w-0 flex-1 w-full overflow-hidden bg-[var(--surface-root)] lg:h-full lg:min-h-[350px]",
							fullscreen ? "rounded-lg" : "rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)]",
						)}
					/>
				</div>
				{showFileManager && (
				<SshFileManager serverId={serverId} visible={showFileManager} />
			)}
			{showSidePanel && (
					<SshTerminalSidePanel
						serverId={serverId}
						t={t}
						favoriteCommands={favoriteCommands}
						newFavorite={newFavorite}
						setNewFavorite={setNewFavorite}
						addFavorite={addFavorite}
						removeFavorite={removeFavorite}
						commandHistory={commandHistory}
						sendCommand={sendCommand}
						sendKeys={sendKeys}
						customQuickKeys={customQuickKeys}
						onAddQuickKey={addQuickKeyPreset}
						onResetQuickKeys={resetQuickKeyPresets}
						fontSize={fontSize}
						onFontSizeChange={changeFontSize}
					/>
				)}
			</div>
		</div>
	);
}
