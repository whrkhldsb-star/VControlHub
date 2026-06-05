"use client";

import { useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildSshWebSocketUrl } from "@/components/ssh-terminal-url";

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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={`ssh-terminal-title-${serverId}`}
				aria-describedby={`ssh-terminal-host-${serverId}`}
				className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl light:text-slate-950 dark:border-white/10 dark:bg-slate-900 dark:text-white"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-white/10">
					<div className="flex items-center gap-3">
						<span className="text-xl" aria-hidden="true">💻</span>
						<div>
							<h3 id={`ssh-terminal-title-${serverId}`} className="text-lg font-semibold text-slate-950 dark:text-white">
								SSH 终端 — {serverName}
							</h3>
							<p id={`ssh-terminal-host-${serverId}`} className="text-xs text-slate-600 dark:text-slate-400">{host}</p>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<span
							role="status"
							aria-live="polite"
							className={`rounded-full px-3 py-1 text-xs ${
								status === "connected"
									? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
									: status === "connecting"
									? "border border-amber-400/40 bg-amber-500/15 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
									: "border border-rose-400/40 bg-rose-500/15 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"
							}`}
						>
							{status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "error" ? "连接失败" : "已断开"}
						</span>
						<button
							type="button"
							onClick={() => setShowSidePanel(!showSidePanel)}
							aria-expanded={showSidePanel}
							className={`rounded-full border px-4 py-1.5 text-xs transition ${showSidePanel ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-100" : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"}`}
							title="命令面板"
						>
							📋 命令面板
						</button>
						{(status === "error" || status === "closed") && (
							<button
								type="button"
								onClick={handleReconnect}
								className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-4 py-1.5 text-xs text-cyan-700 transition hover:bg-cyan-500/25 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-100 dark:hover:bg-cyan-400/20"
							>
								重连
							</button>
						)}
						<button
							type="button"
							onClick={onClose}
							aria-label="关闭 SSH 终端"
							className="rounded-full border border-slate-300 bg-slate-100 px-4 py-1.5 text-xs text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
						>
							关闭
						</button>
					</div>
				</div>

				{errorMsg && (status === "error" || status === "closed") && (
					<div className="mx-6 mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200 light:text-rose-800">
						❌ {errorMsg}
					</div>
				)}

				<div className="flex flex-1 gap-0 overflow-hidden p-4">
					<div className="flex-1 overflow-hidden">
						<div ref={termRef} className="h-full w-full overflow-hidden rounded-2xl border border-white/10 light:border-slate-200 bg-[#0a0e1a]" style={{ minHeight: "400px" }} />
					</div>
					{showSidePanel && (
						<div className="ml-3 flex w-64 shrink-0 flex-col gap-3 overflow-y-auto">
							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white light:text-slate-900/60">⭐ 常用命令</h4>
								<div className="mb-2 flex gap-1.5">
									<input
										value={newFavorite}
										onChange={(e) => setNewFavorite(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && addFavorite()}
										placeholder="添加常用命令…"
										className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[11px] font-mono text-white light:text-slate-900 outline-none placeholder:text-white/20 focus:border-cyan-400/30"
									/>
									<button onClick={addFavorite} className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200 light:text-cyan-800 transition hover:bg-cyan-400/20">
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
													className="flex-1 truncate rounded-md px-2 py-1 text-left text-[11px] font-mono text-cyan-100/80 light:text-cyan-900/80 transition hover:bg-white/[0.06]"
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
								<h4 className="mb-2 text-xs font-medium text-white light:text-slate-900/60">📜 命令历史</h4>
								{commandHistory.length === 0 ? (
									<p className="text-[10px] text-slate-600">暂无历史命令</p>
								) : (
									<div className="max-h-[300px] space-y-1 overflow-y-auto">
										{commandHistory.map((cmd, i) => (
											<button
												key={`${cmd}-${i}`}
												onClick={() => sendCommand(cmd)}
												className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-mono text-slate-400 light:text-slate-600 transition hover:bg-white/[0.06] hover:text-cyan-100/80"
												title={cmd}
											>
												{cmd}
											</button>
										))}
									</div>
								)}
							</section>

							<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
								<h4 className="mb-2 text-xs font-medium text-white light:text-slate-900/60">⚡ 快捷命令</h4>
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
