"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

/* ------------------------------------------------------------------ */
/* SSH Terminal Modal — xterm.js + WebSocket */
/* ------------------------------------------------------------------ */

/* ── Browser-compatible base64 helpers (no Node Buffer) ──────── */

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
		} catch { return []; }
	});
 const [newFavorite, setNewFavorite] = useState("");

 // Determine WS URL — connect via same origin (Apache/Caddy proxies /ssh to WS proxy)
 const wsUrl = useMemo(() => {
 if (typeof window === "undefined") return "";
 const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
 const wsHost = window.location.host; // includes port if non-standard
 return `${protocol}//${wsHost}/ssh?serverId=${serverId}&token=${encodeURIComponent(sessionToken)}`;
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [serverId, sessionToken, reconnectKey]);

 // Initialize xterm and WebSocket
 useEffect(() => {
 if (!wsUrl || !termRef.current) return;

 let disposed = false;

 async function init() {
 // Dynamic imports for xterm (client-only)
 const { Terminal } = await import("@xterm/xterm");
 const { FitAddon } = await import("@xterm/addon-fit");

 if (disposed || !termRef.current) return;

 // ── Fetch SSH_WS_SECRET from server API ────────────────────
 let wsSecret = "";
 try {
 const data = await csrfFetch("/api/auth/ws-token");
wsSecret = data.secret || "";
 } catch {
 // If the API is unreachable, try connecting without secret
 // (development mode may not require it)
 }

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
      term.open(termRef.current!);
      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

 // Connect WebSocket
 const finalWsUrl = wsSecret ? `${wsUrl}&secret=${encodeURIComponent(wsSecret)}` : wsUrl;
 const ws = new WebSocket(finalWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setStatus("connected");
        // Send initial resize
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
            const data = decodeBase64(msg.data);
            term.write(data);
          } else if (msg.type === "connected") {
            if (!disposed) setStatus("connected");
          } else if (msg.type === "error") {
            if (!disposed) {
              setStatus("error");
              setErrorMsg(msg.data || "未知错误");
            }
          } else if (msg.type === "closed") {
            if (!disposed) {
              setStatus("closed");
              setErrorMsg(msg.data || "连接已关闭");
            }
          }
        } catch {
          // Ignore
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setStatus("closed");
          setErrorMsg("WebSocket 连接已断开");
        }
      };

      ws.onerror = () => {
        if (!disposed) {
          setStatus("error");
          setErrorMsg("WebSocket 连接失败，请确认 SSH 代理服务正在运行");
        }
      };

	 // Send keyboard input + track commands
 term.onData((data: string) => {
 if (ws.readyState === WebSocket.OPEN) {
 ws.send(JSON.stringify({
 type: "input",
 data: encodeBase64(data),
 }));
 }
 // Track Enter key to capture command history
 if (data === "\r" || data === "\n") {
 // Read current line from terminal buffer
 const buffer = term.buffer.active;
 const line = buffer.getLine(buffer.cursorY)?.translateToString(true, buffer.cursorX ?? 0);
 const cmd = (line ?? "").trim();
 if (cmd) {
 setCommandHistory((prev) => {
 const next = [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50);
 return next;
 });
 }
 }
 });

      // Handle resize
      const handleResize = () => {
        if (fitAddonRef.current) {
          try { fitAddonRef.current.fit(); } catch {}
        }
        if (ws.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }));
        }
      };

      window.addEventListener("resize", handleResize);

      // Import xterm CSS
      await import("@xterm/xterm/css/xterm.css");
    }

    init();

    return () => {
      disposed = true;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      if (terminalRef.current) {
        try { terminalRef.current.dispose(); } catch {}
        terminalRef.current = null;
      }
    };
  }, [wsUrl]);

 // Save favorites to localStorage whenever they change
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

 const handleReconnect = () => {
 if (wsRef.current) {
 try { wsRef.current.close(); } catch {}
 }
 if (terminalRef.current) {
 try { terminalRef.current.dispose(); } catch {}
 terminalRef.current = null;
 }
 setStatus("connecting");
 setErrorMsg("");
 // Trigger re-connect by bumping the reconnect key (forces useMemo recalc + useEffect re-run)
 setReconnectKey((prev) => prev + 1);
 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-900 shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">💻</span>
            <div>
              <h3 className="text-lg font-semibold text-white">SSH 终端 — {serverName}</h3>
              <p className="text-xs text-slate-400">{host}</p>
            </div>
          </div>
				<div className="flex items-center gap-3">
					<span className={`rounded-full px-3 py-1 text-xs ${
						status === "connected"
							? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
							: status === "connecting"
							? "border border-amber-400/30 bg-amber-400/10 text-amber-200"
							: "border border-rose-400/30 bg-rose-400/10 text-rose-200"
					}`}>
						{status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "error" ? "连接失败" : "已断开"}
					</span>
					<button
						type="button"
					onClick={() => setShowSidePanel(!showSidePanel)}
						className={`rounded-full border px-4 py-1.5 text-xs transition ${showSidePanel ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
						title="命令面板"
					>
						📋 命令面板
					</button>
					{(status === "error" || status === "closed") && (
						<button
							type="button"
							onClick={handleReconnect}
							className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs text-cyan-100 hover:bg-cyan-400/20 transition"
						>
							重连
						</button>
					)}
					<button
						type="button"
						onClick={onClose}
						className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition"
					>
						关闭
					</button>
				</div>
        </div>

        {/* Error message */}
        {errorMsg && (status === "error" || status === "closed") && (
          <div className="mx-6 mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
            ❌ {errorMsg}
          </div>
        )}

		 {/* Terminal container + side panel */}
		 <div className="flex-1 overflow-hidden flex gap-0 p-4">
			<div className={`flex-1 overflow-hidden transition-all ${showSidePanel ? "" : ""}`}>
				<div
				 ref={termRef}
				 className="h-full w-full rounded-2xl border border-white/10 bg-[#0a0e1a] overflow-hidden"
				 style={{ minHeight: "400px" }}
				/>
			</div>
			{showSidePanel && (
				<div className="ml-3 w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
					{/* Favorite commands */}
					<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
						<h4 className="text-xs font-medium text-white/60 mb-2">⭐ 常用命令</h4>
						<div className="flex gap-1.5 mb-2">
							<input
								value={newFavorite}
								onChange={(e) => setNewFavorite(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && addFavorite()}
								placeholder="添加常用命令…"
								className="flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[11px] text-white font-mono outline-none placeholder:text-white/20 focus:border-cyan-400/30"
							/>
							<button onClick={addFavorite} className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-400/20 transition">+</button>
						</div>
						{favoriteCommands.length === 0 ? (
							<p className="text-[10px] text-slate-600">暂无常用命令</p>
						) : (
							<div className="space-y-1">
								{favoriteCommands.map((cmd) => (
									<div key={cmd} className="flex items-center gap-1 group">
										<button
											onClick={() => sendCommand(cmd)}
											className="flex-1 text-left rounded-md px-2 py-1 text-[11px] font-mono text-cyan-100/80 hover:bg-white/[0.06] truncate transition"
											title={cmd}
										>
											{cmd}
										</button>
										<button
											onClick={() => removeFavorite(cmd)}
											className="shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-rose-400/60 hover:text-rose-300 transition"
										>
											✕
										</button>
									</div>
								))}
							</div>
						)}
					</section>

					{/* Command history */}
					<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
						<h4 className="text-xs font-medium text-white/60 mb-2">📜 命令历史</h4>
						{commandHistory.length === 0 ? (
							<p className="text-[10px] text-slate-600">暂无历史命令</p>
						) : (
							<div className="space-y-1 max-h-[300px] overflow-y-auto">
								{commandHistory.map((cmd, i) => (
									<button
										key={`${cmd}-${i}`}
										onClick={() => sendCommand(cmd)}
										className="block w-full text-left rounded-md px-2 py-1 text-[11px] font-mono text-slate-400 hover:bg-white/[0.06] hover:text-cyan-100/80 truncate transition"
										title={cmd}
									>
										{cmd}
									</button>
								))}
							</div>
						)}
					</section>

					{/* Quick commands */}
					<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
						<h4 className="text-xs font-medium text-white/60 mb-2">⚡ 快捷命令</h4>
						<div className="space-y-1">
							{["ls -la", "df -h", "free -m", "top -bn1 | head -20", "uptime", "whoami", "cat /etc/os-release", "ps aux --sort=-%mem | head -10"].map((cmd) => (
								<button
									key={cmd}
									onClick={() => sendCommand(cmd)}
									className="block w-full text-left rounded-md px-2 py-1 text-[11px] font-mono text-slate-500 hover:bg-white/[0.06] hover:text-cyan-100/80 transition truncate"
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
