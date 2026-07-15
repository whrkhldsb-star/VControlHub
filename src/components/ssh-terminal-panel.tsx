"use client";

import { decodeBase64, encodeBase64 } from "@/components/ssh-terminal-codec";

import { useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";
import { useI18n } from "@/lib/i18n/use-locale";
import { SshFileManager } from "@/components/ssh-file-manager";
import { SshTerminalSidePanel } from "@/components/ssh-terminal-side-panel";
import { SshTerminalSearchBar, SshTerminalToolbar } from "@/components/ssh-terminal-chrome";
import type { TerminalStatus } from "@/components/ssh-terminal-types";
export type { TerminalStatus } from "@/components/ssh-terminal-types";

/* ------------------------------------------------------------------ */
/* SshTerminalPanel — single-tab terminal logic (extracted from modal) */
/* ------------------------------------------------------------------ */


export type SshTerminalPanelProps = {
	serverId: string;
	serverName: string;
	host: string;
	sessionToken: string;
	/** When false, the panel is hidden via CSS but keeps its WS + terminal alive. */
	visible: boolean;
	/** Called when the user clicks the close button on this tab. */
	onClose: () => void;
	/** Called when connection status changes (for tab badge display). */
	onStatusChange?: (status: TerminalStatus) => void;
};

export function SshTerminalPanel({ serverId, serverName, host, sessionToken, visible, onClose, onStatusChange }: SshTerminalPanelProps) {
	const { t } = useI18n();
	const termRef = useRef<HTMLDivElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const searchAddonRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
	const currentCommandRef = useRef("");
	const connectionNonceRef = useRef(0);

	const [status, setStatus] = useState<TerminalStatus>("connecting");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [reconnectKey, setReconnectKey] = useState(0);
	const [showSidePanel, setShowSidePanel] = useState(false);
	const [showFileManager, setShowFileManager] = useState(false);
	const [terminalSearch, setTerminalSearch] = useState("");
	const [commandHistory, setCommandHistory] = useState<string[]>([]);
	const [favoriteCommands, setFavoriteCommands] = useState<string[]>(() => {
		if (typeof window === "undefined") return [];
		try {
			const stored = localStorage.getItem("ssh-favorite-commands");
			return stored ? JSON.parse(stored) : [];
		} catch {
			return [];
		}
	});
	const [newFavorite, setNewFavorite] = useState("");

	// Notify parent of status changes
	useEffect(() => {
		onStatusChange?.(status);
	}, [status, onStatusChange]);

	// Refit terminal when tab becomes visible (xterm needs visible DOM to fit)
	useEffect(() => {
		if (visible && fitAddonRef.current && terminalRef.current) {
			// Small delay to ensure DOM is visible before fit
			const timer = setTimeout(() => {
				try {
					fitAddonRef.current?.fit();
					if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
						wsRef.current.send(JSON.stringify({
							type: "resize",
							cols: terminalRef.current.cols,
							rows: terminalRef.current.rows,
						}));
					}
				} catch {}
			}, 50);
			return () => clearTimeout(timer);
		}
	}, [visible]);

	function disposeConnection() {
		connectionNonceRef.current += 1;
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

	useEffect(() => {
		if (!termRef.current) return;

		let disposed = false;
		const nonce = connectionNonceRef.current;

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
					body: JSON.stringify({ serverId, sessionToken }),
				});
				handshakeToken = data.token || "";
			} catch {
				// Token fetch failed — surface the error to the user and abort the connection.
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(t("sshTerminalModal.errTokenFetchFailed"));
				}
				return;
			}

			if (!handshakeToken) {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(t("sshTerminalModal.errTokenEmpty"));
				}
				return;
			}

			if (disposed || nonce !== connectionNonceRef.current || !termRef.current) return;

			const term = new Terminal({
				cursorBlink: true,
				fontSize: 14,
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
			fitAddon.fit();

			terminalRef.current = term;
			fitAddonRef.current = fitAddon;
			searchAddonRef.current = searchAddon;

			const finalWsUrl = buildSshWebSocketUrl({
				pageProtocol: window.location.protocol,
				host: window.location.host,
				serverId,
				sessionToken,
				handshakeToken,
			});
			const ws = new WebSocket(finalWsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				if (!disposed && nonce === connectionNonceRef.current) setStatus("connected");
				ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
			};

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data);
					if (msg.type === "output" && msg.data) {
						term.write(decodeBase64(msg.data));
					} else if (msg.type === "connected") {
						if (!disposed && nonce === connectionNonceRef.current) setStatus("connected");
					} else if (msg.type === "error") {
						if (!disposed && nonce === connectionNonceRef.current) {
							setStatus("error");
							setErrorMsg(msg.data || t("sshTerminalModal.errUnknown"));
						}
					} else if (msg.type === "closed") {
						if (!disposed && nonce === connectionNonceRef.current) {
							setStatus("closed");
							setErrorMsg(msg.data || t("sshTerminalModal.errClosed"));
						}
					}
				} catch {}
			};

			ws.onclose = () => {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("closed");
					setErrorMsg(t("sshTerminalModal.errDisconnected"));
				}
			};

			ws.onerror = () => {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg(t("sshTerminalModal.errConnectionFailed"));
				}
			};

			term.onData((data: string) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "input", data: encodeBase64(data) }));
				}
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

			const handleResize = () => {
				if (fitAddonRef.current) { try { fitAddonRef.current.fit(); } catch {} }
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
				}
			};

			window.addEventListener("resize", handleResize);
			return () => window.removeEventListener("resize", handleResize);
		}

		let removeResizeListener: (() => void) | undefined;
		void init().then((cleanup) => { removeResizeListener = cleanup; });

		return () => {
			disposed = true;
			if (removeResizeListener) removeResizeListener();
			if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
			if (terminalRef.current) { try { terminalRef.current.dispose(); } catch {} terminalRef.current = null; }
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
	}, [serverId, sessionToken, reconnectKey, t]);

	const saveFavorites = (items: string[]) => {
		try { localStorage.setItem("ssh-favorite-commands", JSON.stringify(items)); } catch {}
	};

	const addFavorite = () => {
		const cmd = newFavorite.trim();
		if (!cmd || favoriteCommands.includes(cmd)) return;
		const next = [...favoriteCommands, cmd];
		setFavoriteCommands(next);
		saveFavorites(next);
		setNewFavorite("");
	};

	const removeFavorite = (cmd: string) => {
		const next = favoriteCommands.filter((c) => c !== cmd);
		setFavoriteCommands(next);
		saveFavorites(next);
	};

	const sendCommand = (cmd: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "input", data: encodeBase64(cmd + "\r") }));
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
		setStatus("connecting");
		setErrorMsg("");
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
				onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
				onToggleFileManager={() => setShowFileManager(!showFileManager)}
				onReconnect={handleReconnect}
				onClose={onClose}
			/>

			{/* Error banner */}
			{errorMsg && (status === "error" || status === "closed") && (
				<div data-tone="rose" className="mx-4 mt-3 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm text-[var(--danger)]">
					❌ {errorMsg}
				</div>
			)}

			{/* Terminal + side panel */}
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden">
				<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
					<SshTerminalSearchBar
						serverId={serverId}
						t={t}
						terminalSearch={terminalSearch}
						onSearchChange={setTerminalSearch}
						onSearch={searchTerminal}
						onClear={clearTerminalSearch}
					/>
					<div
						ref={termRef}
						data-testid="ssh-terminal-surface"
						className="h-[clamp(280px,52vh,520px)] w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-root)] lg:h-full lg:min-h-[350px]"
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
					/>
				)}
			</div>
		</div>
	);
}
