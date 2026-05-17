"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";

interface Container {
	Id: string;
	Names: string[];
	Image: string;
	State: string;
	Status: string;
	Ports: { IP: string; PrivatePort: number; PublicPort: number; Type: string }[];
}

export default function DockerPage() {
	const [containers, setContainers] = useState<Container[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [logsId, setLogsId] = useState<string | null>(null);
	const [logs, setLogs] = useState("");
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	const fetchContainers = async () => {
		try {
			const data = await csrfFetch("/api/docker/containers");
if (data.error) { setError(data.error); return; }
			if (data.data && Array.isArray(data.data)) {
				setContainers(data.data);
			} else if (Array.isArray(data)) {
				setContainers(data);
			}
		} catch { setError("无法连接 Docker API"); }
		finally { setLoading(false); }
	};

	const handleAction = async (id: string, action: "start" | "stop" | "restart" | "remove") => {
		setActionLoading(id);
		try {
			await csrfFetch("/api/docker/containers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, action }),
			});
			await fetchContainers();
		} catch { /* ignore */ }
		finally { setActionLoading(null); }
	};

	const fetchLogs = async (id: string) => {
		setLogsId(id);
		try {
			const data = await csrfFetch(`/api/docker/containers?logs=${id}&tail=50`);
			setLogs(typeof data.data === "string" ? data.data : JSON.stringify(data.data, null, 2));
		} catch { setLogs("获取日志失败"); }
	};


	useEffect(() => { fetchContainers(); }, []);

	const stateColors: Record<string, string> = {
		running: "bg-emerald-500/10 text-emerald-400",
		exited: "bg-slate-700/50 text-slate-400",
		paused: "bg-amber-500/10 text-amber-400",
		created: "bg-blue-500/10 text-blue-400",
		restarting: "bg-orange-500/10 text-orange-400",
	};

	return (
		<PageShell>
			<h1 className="text-2xl font-bold mb-1">Docker 容器</h1>
			<p className="text-slate-400 mb-6">管理本机 Docker 容器</p>
			<div className="flex items-center gap-3 mb-6">
				<button
					onClick={() => { setLoading(true); fetchContainers(); }}
					className="px-3 py-1.5 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition"
				>
					刷新列表
				</button>
			</div>

			{error && (
				<div className="mb-4 text-sm text-rose-400 bg-rose-500/10 rounded-lg px-4 py-3">{error}</div>
			)}

			{loading ? (
				<div className="text-sm text-slate-500">加载中...</div>
			) : containers.length === 0 ? (
				<div className="text-sm text-slate-500 bg-white/[0.02] rounded-xl border border-white/[0.06] p-8 text-center">
					未发现 Docker 容器，或 Docker 服务未运行
				</div>
			) : (
				<div className="space-y-3">
					{containers.map((c) => (
						<div key={c.Id} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
							<div className="flex items-center justify-between mb-2">
								<div className="flex items-center gap-3">
									<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-slate-700/50 text-slate-400"}`}>
										{c.State}
									</span>
									<span className="text-sm font-medium text-white">
										{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}
									</span>
								</div>
								<span className="text-[10px] text-slate-500">{c.Image}</span>
							</div>
							<div className="flex items-center gap-2 text-[11px] text-slate-500 mb-3">
								<span>{c.Status}</span>
							</div>
							<div className="flex items-center gap-2">
								{c.State !== "running" && (
									<button onClick={() => handleAction(c.Id, "start")} disabled={actionLoading === c.Id}
										className="px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition disabled:opacity-50">启动</button>
								)}
								{c.State === "running" && (
									<>
										<button onClick={() => handleAction(c.Id, "stop")} disabled={actionLoading === c.Id}
											className="px-2.5 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition disabled:opacity-50">停止</button>
										<button onClick={() => handleAction(c.Id, "restart")} disabled={actionLoading === c.Id}
											className="px-2.5 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition disabled:opacity-50">重启</button>
									</>
								)}
								<button onClick={() => fetchLogs(c.Id)}
									className="px-2.5 py-1 text-[10px] bg-slate-700/50 text-slate-300 rounded-lg hover:bg-slate-700 transition">日志</button>
								<button onClick={() => handleAction(c.Id, "remove")} disabled={actionLoading === c.Id}
									className="px-2.5 py-1 text-[10px] bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50">删除</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Logs Modal */}
			{logsId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setLogsId(null)}>
					<div className="w-full max-w-2xl mx-4 bg-slate-950 border border-white/[0.08] rounded-2xl p-5 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<h3 className="text-sm font-medium text-white">容器日志 — {logsId.slice(0, 12)}</h3>
							<button onClick={() => setLogsId(null)} className="text-slate-500 hover:text-slate-300">
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<pre className="flex-1 overflow-auto text-[11px] text-slate-300 bg-black/40 rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
					</div>
				</div>
			)}
		</PageShell>
	);
}
