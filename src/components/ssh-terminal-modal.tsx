"use client";

import { useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

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
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const termRef = useRef<HTMLDivElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const connectionNonceRef = useRef(0);

	const [status, setStatus] = useState<"connecting" | "connected" | "error" | "closed">("connecting");
	const [errorMsg, setErrorMsg] = useState<string>("");
	const [reconnectKey, setReconnectKey] = useState(0);
	const [showSidePanel, setShowSidePanel] = useState(false);
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
			const [{ Terminal }, { FitAddon }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
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
					setErrorMsg("无法获取 SSH WebSocket 临时令牌，请重新登录后再试");
				}
				return;
			}

			if (!handshakeToken) {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg("SSH WebSocket 临时令牌为空，请检查服务配置");
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
			term.loadAddon(fitAddon);
			term.open(termRef.current);
			fitAddon.fit();

			terminalRef.current = term;
			fitAddonRef.current = fitAddon;

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
							setErrorMsg(msg.data || "未知错误");
						}
					} else if (msg.type === "closed") {
						if (!disposed && nonce === connectionNonceRef.current) {
							setStatus("closed");
							setErrorMsg(msg.data || "连接已关闭");
						}
					}
				} catch {
					// ignore malformed messages
				}
			};

			ws.onclose = () => {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("closed");
					setErrorMsg("WebSocket 连接已断开");
				}
			};

			ws.onerror = () => {
				if (!disposed && nonce === connectionNonceRef.current) {
					setStatus("error");
					setErrorMsg("WebSocket 连接失败，请确认 SSH 代理服务正在运行");
				}
			};

			term.onData((data: string) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "input", data: encodeBase64(data) }));
				}
				if (data === "\r" || data === "\n") {
					const buffer = term.buffer.active;
					const line = buffer.getLine(buffer.cursorY)?.translateToString(true, buffer.cursorX ?? 0);
					const cmd = (line ?? "").trim();
					if (cmd) {
						setCommandHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50));
					}
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
		};
	}, [serverId, sessionToken, reconnectKey]);

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
								SSH 终端 — {serverName}
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
							{status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "error" ? "连接失败" : "已断开"}
						</span>
						<button
							type="button"
							onClick={() => setShowSidePanel(!showSidePanel)}
							aria-expanded={showSidePanel}
							className={`rounded-full border px-4 py-1.5 text-xs transition ${showSidePanel ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 light:border-cyan-500/40 light:bg-cyan-500/15" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 light:hover:bg-slate-200"}`}
							title="命令面板"
						>
							📋 命令面板
						</button>
						{(status === "error" || status === "closed") && (
							<button
								type="button"
								onClick={handleReconnect}
								className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-400/20 light:border-cyan-500/40 light:bg-cyan-500/15 light:hover:bg-cyan-500/25"
							>
								重连
							</button>
						)}
						<button
							ref={closeButtonRef}
							type="button"
							onClick={onClose}
							aria-label="关闭 SSH 终端"
							className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 light:hover:bg-slate-200"
						>
							关闭
						</button>
					</div>
				</div>

				{errorMsg && (status === "error" || status === "closed") && (
					<div className="mx-6 mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
						❌ {errorMsg}
					</div>
				)}

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:flex-row lg:overflow-hidden">
					<div className="min-h-0 flex-1 overflow-hidden">
						<div
							ref={termRef}
							data-testid="ssh-terminal-surface"
							className="h-[clamp(320px,58vh,560px)] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a0e1a] lg:h-full lg:min-h-[400px]"
						/>
					</div>
					{showSidePanel && (
						<div className="flex max-h-[50vh] w-full shrink-0 flex-col gap-3 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-64">
							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">⭐ 常用命令</h4>
								<div className="mb-2 flex gap-1.5">
									<label htmlFor={`ssh-favorite-command-${serverId}`} className="sr-only">
										添加常用 SSH 命令
									</label>
									<input
										id={`ssh-favorite-command-${serverId}`}
										value={newFavorite}
										onChange={(e) => setNewFavorite(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && addFavorite()}
										placeholder="添加常用命令…"
										className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[11px] font-mono text-white outline-none placeholder:text-white/20 focus:border-cyan-400/30"
									/>
									<button onClick={addFavorite} className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200 transition hover:bg-cyan-400/20">
										+
									</button>
								</div>
								{favoriteCommands.length === 0 ? (
									<p className="text-[10px] text-slate-600">暂无常用命令</p>
								) : (
									<div className="space-y-1">
										{favoriteCommands.map((cmd) => (
											<div key={cmd} className="group flex items-center gap-1">
												<button
													onClick={() => sendCommand(cmd)}
													className="flex-1 truncate rounded-md px-2 py-1 text-left text-[11px] font-mono text-cyan-100/80 transition hover:bg-white/[0.06]"
													title={cmd}
												>
													{cmd}
												</button>
												<button
													onClick={() => removeFavorite(cmd)}
													className="shrink-0 text-[10px] text-rose-400/60 opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
												>
													✕
												</button>
											</div>
										))}
									</div>
								)}
							</section>

							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">📜 命令历史</h4>
								{commandHistory.length === 0 ? (
									<p className="text-[10px] text-slate-600">暂无历史命令</p>
								) : (
									<div className="max-h-[300px] space-y-1 overflow-y-auto">
										{commandHistory.map((cmd, i) => (
											<button
												key={`${cmd}-${i}`}
												onClick={() => sendCommand(cmd)}
												className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-mono text-[var(--text-secondary)] transition hover:bg-white/[0.06] hover:text-cyan-100/80"
												title={cmd}
											>
												{cmd}
											</button>
										))}
									</div>
								)}
							</section>

							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white/60">⚡ 快捷命令</h4>
								<div className="space-y-1">
									{["ls -la", "df -h", "free -m", "top -bn1 | head -20", "uptime", "whoami", "cat /etc/os-release", "ps aux --sort=-%mem | head -10"].map((cmd) => (
										<button
											key={cmd}
											onClick={() => sendCommand(cmd)}
											className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-mono text-slate-500 transition hover:bg-white/[0.06] hover:text-cyan-100/80"
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
