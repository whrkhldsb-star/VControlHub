"use client";

import { useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { useI18n } from "@/lib/i18n/use-locale";

/* ------------------------------------------------------------------ */
/* SSH Terminal Modal — xterm.js + WebSocket */
/* ------------------------------------------------------------------ */

function decodeBase64(b64: string): string {
	try {
		return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
	} catch {
		return atob(b64);
	}
}

function encodeBase64(str: string): string {
	return btoa(unescape(encodeURIComponent(str)));
}

type SshTerminalModalProps = {
	serverId: string;
	serverName: string;
	host: string;
	sessionToken: string;
	onClose: () => void;
};

export function SshTerminalModal({ serverId, serverName, host, sessionToken, onClose }: SshTerminalModalProps) {
	const { t } = useI18n();
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const termRef = useRef<HTMLDivElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const searchAddonRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
	const currentCommandRef = useRef("");
	const connectionNonceRef = useRef(0);

	const [status, setStatus] = useState<"connecting" | "connected" | "error" | "closed">("connecting");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [reconnectKey, setReconnectKey] = useState(0);
	const [showSidePanel, setShowSidePanel] = useState(false);
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

	function disposeConnection() {
		connectionNonceRef.current += 1;
		if (wsRef.current) {
			try {
				wsRef.current.close();
			} catch {}
			wsRef.current = null;
		}
		if (terminalRef.current) {
			try {
				terminalRef.current.dispose();
			} catch {}
			terminalRef.current = null;
		}
		fitAddonRef.current = null;
		searchAddonRef.current = null;
	}

	const dialogRef = useDialogFocus<HTMLDivElement>({
		open: true,
		onClose,
		initialFocusRef: closeButtonRef,
	});

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
				ws.send(JSON.stringify({
					type: "resize",
					cols: term.cols,
					rows: term.rows,
				}));
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
				} catch {
					// ignore malformed messages
				}
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
				if (fitAddonRef.current) {
					try {
						fitAddonRef.current.fit();
					} catch {}
				}
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({
						type: "resize",
						cols: term.cols,
						rows: term.rows,
					}));
				}
			};

			window.addEventListener("resize", handleResize);

			return () => window.removeEventListener("resize", handleResize);
		}

		let removeResizeListener: (() => void) | undefined;
		void init().then((cleanup) => {
			removeResizeListener = cleanup;
		});

		return () => {
			disposed = true;
			if (removeResizeListener) {
				removeResizeListener();
			}
			if (wsRef.current) {
				try {
					wsRef.current.close();
				} catch {}
				wsRef.current = null;
			}
			if (terminalRef.current) {
				try {
					terminalRef.current.dispose();
				} catch {}
				terminalRef.current = null;
			}
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
	}, [serverId, sessionToken, reconnectKey, t]);

	const saveFavorites = (items: string[]) => {
		try {
			localStorage.setItem("ssh-favorite-commands", JSON.stringify(items));
		} catch {}
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
		if (direction === "previous") {
			searchAddonRef.current.findPrevious(query);
		} else {
			searchAddonRef.current.findNext(query);
		}
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
		<div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
			<div
				ref={dialogRef}
				role="dialog"
				data-ssh-terminal-dialog="true"
				style={{
					backgroundColor: "var(--surface)",
					borderColor: "var(--border)",
					color: "var(--text-primary)",
				}}
				aria-modal="true"
				aria-labelledby={`ssh-terminal-title-${serverId}`}
				aria-describedby={`ssh-terminal-host-${serverId}`}
				className="my-auto flex max-h-none min-h-0 w-full max-w-5xl flex-col rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
					<div className="flex items-center gap-3">
						<span className="text-xl" aria-hidden="true">💻</span>
						<div>
							<h3 id={`ssh-terminal-title-${serverId}`} className="text-lg font-semibold text-white">
								{t("sshTerminalModal.title").replace("{serverName}", serverName)}
							</h3>
							<p id={`ssh-terminal-host-${serverId}`} className="text-xs text-[var(--text-secondary)]">{host}</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 sm:gap-3 md:justify-end">
						<span
							role="status"
							aria-live="polite"
							className={`rounded-full px-3 py-1 text-xs ${
								status === "connected"
									? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 light:border-emerald-400/40 light:bg-emerald-500/15"
									: status === "connecting"
									? "border border-amber-400/30 bg-amber-400/10 text-amber-200 light:border-amber-400/40 light:bg-amber-500/15"
									: "border border-rose-400/30 bg-rose-400/10 text-rose-200 light:border-rose-400/40 light:bg-rose-500/15"
							}`}
						>
							{status === "connected"
								? t("sshTerminalModal.statusConnected")
								: status === "connecting"
									? t("sshTerminalModal.statusConnecting")
									: status === "error"
										? t("sshTerminalModal.statusError")
										: t("sshTerminalModal.statusClosed")}
						</span>
						<button
							type="button"
							onClick={() => setShowSidePanel(!showSidePanel)}
							aria-expanded={showSidePanel}
							className={`min-h-11 min-w-11 rounded-full border px-4 py-1.5 text-xs transition ${showSidePanel ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--color-action-fg)] light:border-[var(--color-action-border)]/40 light:bg-[var(--color-action)]/15" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 light:hover:bg-slate-200"}`}
							title={t("sshTerminalModal.panelToggleTitle")}
							>
							{t("sshTerminalModal.panelToggle")}
							</button>
						{(status === "error" || status === "closed") && (
							<button
								type="button"
								onClick={handleReconnect}
								data-tone="cyan" className="min-h-11 min-w-11 rounded-full border border-[var(--color-action-border)]/30 px-4 py-1.5 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20 light:border-[var(--color-action-border)]/40 light:bg-[var(--color-action)]/15 light:hover:bg-[var(--color-action)]/25"
							>
								{t("sshTerminalModal.reconnect")}
							</button>
						)}
						<button
							ref={closeButtonRef}
							type="button"
							onClick={onClose}
							aria-label={t("sshTerminalModal.ariaClose")}
							className="min-h-11 min-w-11 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 light:hover:bg-slate-200"
						>
							{t("sshTerminalModal.close")}
						</button>
					</div>
				</div>

				{errorMsg && (status === "error" || status === "closed") && (
					<div data-tone="rose" className="mx-6 mt-4 rounded-2xl border border-rose-400/20 px-4 py-3 text-sm text-rose-200">
						❌ {errorMsg}
					</div>
				)}

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:flex-row lg:overflow-hidden">
					<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
						<div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2">
							<label htmlFor={`ssh-terminal-search-${serverId}`} className="sr-only">{t("sshTerminalModal.searchLabel")}</label>
							<input
								id={`ssh-terminal-search-${serverId}`}
								value={terminalSearch}
								onChange={(event) => setTerminalSearch(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") searchTerminal(event.shiftKey ? "previous" : "next");
									if (event.key === "Escape") clearTerminalSearch();
								}}
								placeholder={t("sshTerminalModal.searchPlaceholder")}
								className="min-h-10 min-w-[180px] flex-1 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 focus:border-[var(--color-action-border)]/30"
							/>
							<button type="button" onClick={() => searchTerminal("previous")} className="min-h-10 rounded-xl border border-white/[0.08] px-3 text-xs text-slate-200 hover:bg-white/[0.06]">{t("sshTerminalModal.searchPrevious")}</button>
							<button type="button" onClick={() => searchTerminal("next")} data-tone="cyan" className="min-h-10 rounded-xl border border-[var(--color-action-border)]/20 px-3 text-xs text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)]/20">{t("sshTerminalModal.searchNext")}</button>
							<button type="button" onClick={clearTerminalSearch} className="min-h-10 rounded-xl border border-white/[0.08] px-3 text-xs text-slate-400 hover:bg-white/[0.06]">{t("sshTerminalModal.searchClear")}</button>
						</div>
						<div
							ref={termRef}
							data-testid="ssh-terminal-surface"
							className="h-[clamp(320px,58vh,560px)] w-full overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface-root)] lg:h-full lg:min-h-[400px]"
						/>
					</div>
					{showSidePanel && (
						<div className="flex max-h-[50vh] w-full shrink-0 flex-col gap-3 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-64">
							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">{t("sshTerminalModal.favoritesTitle")}</h4>
								<div className="mb-2 flex gap-1.5">
									<label htmlFor={`ssh-favorite-command-${serverId}`} className="sr-only">
										{t("sshTerminalModal.favoritesLabel")}
									</label>
									<input
										id={`ssh-favorite-command-${serverId}`}
										value={newFavorite}
										onChange={(e) => setNewFavorite(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && addFavorite()}
										placeholder={t("sshTerminalModal.favoritesPlaceholder")}
										className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1 text-[13px] font-mono text-white outline-none placeholder:text-white/20 focus:border-[var(--color-action-border)]/30"
									/>
									<button onClick={addFavorite} aria-label={t("sshTerminalModal.favoritesAdd")} data-tone="cyan" className="min-h-11 min-w-11 shrink-0 rounded-lg border border-[var(--color-action-border)]/20 px-2 py-1 text-[13px] text-cyan-200 transition hover:bg-[var(--color-action-bg)]/20">
										+
									</button>
								</div>
								{favoriteCommands.length === 0 ? (
									<p className="text-[10px] text-slate-600">{t("sshTerminalModal.favoritesEmpty")}</p>
								) : (
									<div className="space-y-1">
										{favoriteCommands.map((cmd) => (
											<div key={cmd} className="group flex items-center gap-1">
												<button
													onClick={() => sendCommand(cmd)}
													className="min-h-11 min-w-0 flex-1 truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-[var(--color-action-fg)]/80 transition hover:bg-white/[0.06]"
													title={cmd}
												>
													{cmd}
												</button>
												<button
													onClick={() => removeFavorite(cmd)}
													aria-label={t("sshTerminalModal.favoritesRemove").replace("{cmd}", cmd)}
													className="min-h-11 min-w-11 shrink-0 rounded-lg px-1 text-[12px] text-rose-400/70 transition hover:bg-rose-400/10 hover:text-rose-300 group-hover:opacity-100"
												>
													✕
												</button>
											</div>
										))}
									</div>
								)}
							</section>

							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">{t("sshTerminalModal.historyTitle")}</h4>
								{commandHistory.length === 0 ? (
									<p className="text-[10px] text-slate-600">{t("sshTerminalModal.historyEmpty")}</p>
								) : (
									<div className="max-h-[300px] space-y-1 overflow-y-auto">
										{commandHistory.map((cmd, i) => (
											<button
												key={`${cmd}-${i}`}
												onClick={() => sendCommand(cmd)}
												className="min-h-11 block w-full truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-[var(--text-secondary)] transition hover:bg-white/[0.06] hover:text-[var(--color-action-fg)]/80"
												title={cmd}
											>
												{cmd}
											</button>
										))}
									</div>
								)}
							</section>

							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">{t("sshTerminalModal.quickCommandsTitle")}</h4>
								<div className="space-y-1">
									{["ls -la", "df -h", "free -m", "top -bn1 | head -20", "uptime", "whoami", "cat /etc/os-release", "ps aux --sort=-%mem | head -10"].map((cmd) => (
										<button
											key={cmd}
											onClick={() => sendCommand(cmd)}
											className="min-h-11 block w-full truncate rounded-lg px-3 py-1 text-left text-[12px] font-mono text-slate-500 transition hover:bg-white/[0.06] hover:text-[var(--color-action-fg)]/80"
											title={cmd}
										>
											{cmd}
										</button>
									))}
								</div>
							</section>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
