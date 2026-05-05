"use client";

import { useState, useEffect, useCallback } from "react";

/* ── Types ────────────────────────────────────────────────── */

type ServerOption = { id: string; name: string; host: string; storagePath: string; storageDriver: string };

type DownloadTask = {
	id: string; url: string; serverId: string; targetPath: string; fileName: string | null;
	status: string; progress: string | null; pid: number | null; errorMessage: string | null;
	relayMode: boolean | null; createdAt: string; updatedAt: string;
	aria2Gid: string | null; category: string | null; maxSpeedKb: number | null;
	totalBytes: string | null; completedBytes: string | null; downloadSpeed: string | null;
	fileSize: string | null; isBatch: boolean; batchUrls: string | null;
	server: { id: string; name: string; host: string };
	creator: { id: string; username: string; displayName: string | null } | null;
};

type GlobalStat = { downloadSpeed: string; uploadSpeed: string; numActive: string; numWaiting: string; numStopped: string } | null;

/* ── Status helpers ───────────────────────────────────────── */

const statusBadge: Record<string, string> = {
	PENDING: "border-amber-400/30 bg-amber-400/10 text-amber-100",
	RUNNING: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
	COMPLETED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
	FAILED: "border-rose-400/30 bg-rose-400/10 text-rose-100",
	CANCELLED: "border-slate-400/30 bg-slate-400/10 text-slate-100",
};

const statusLabel: Record<string, string> = {
	PENDING: "等待中", RUNNING: "下载中", COMPLETED: "已完成", FAILED: "失败", CANCELLED: "已取消",
};

const categoryIcon: Record<string, string> = {
	video: "🎬", music: "🎵", software: "💿", document: "📄", image: "🖼️", other: "📦",
};

const categories = [
	{ value: "", label: "未分类", icon: "📦" },
	{ value: "video", label: "影视", icon: "🎬" },
	{ value: "music", label: "音乐", icon: "🎵" },
	{ value: "software", label: "软件", icon: "💿" },
	{ value: "document", label: "文档", icon: "📄" },
	{ value: "image", label: "图片", icon: "🖼️" },
];

function urlTypeLabel(url: string) {
	if (url.startsWith("magnet:?")) return "🧲 磁力链接";
	if (url.startsWith("https://")) return "🔒 HTTPS";
	if (url.startsWith("http://")) return "🔓 HTTP";
	return "❓ 未知";
}

function formatBytes(b: string | number | null): string {
	if (!b) return "—";
	const n = typeof b === "string" ? parseInt(b, 10) : b;
	if (isNaN(n) || n === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatSpeed(b: string | number | null): string {
	if (!b) return "—";
	const n = typeof b === "string" ? parseInt(b, 10) : b;
	if (isNaN(n) || n === 0) return "0 B/s";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function computePct(completed: string | null, total: string | null): number {
	const c = parseInt(completed ?? "0", 10);
	const t = parseInt(total ?? "0", 10);
	if (isNaN(c) || isNaN(t) || t === 0) return 0;
	return Math.min(100, Math.round((c / t) * 10) / 10);
}

/* ── Main Component ───────────────────────────────────────── */

export function DownloadsClient({ servers, canManage }: { servers: ServerOption[]; canManage: boolean }) {
	const [tasks, setTasks] = useState<DownloadTask[]>([]);
	const [globalStat, setGlobalStat] = useState<GlobalStat>(null);
	const [loading, setLoading] = useState(true);
	const [showForm, setShowForm] = useState(false);
	const [filter, setFilter] = useState("ALL");
	const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const defaultServer = servers[0];
	const defaultTargetPath = defaultServer?.storagePath ?? "/root/downloads";
	const [form, setForm] = useState({
		url: "", serverId: defaultServer?.id ?? "", targetPath: defaultTargetPath,
		fileName: "", category: "", maxSpeedKb: "", batchMode: false, batchText: "",
	});
	const [submitting, setSubmitting] = useState(false);

	const fetchTasks = useCallback(async () => {
		try {
			const res = await fetch("/api/downloads");
			if (res.ok) {
				const data = await res.json();
				setTasks(data.tasks ?? data);
				setGlobalStat(data.globalStat ?? null);
			}
		} catch {} finally { setLoading(false); }
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchTasks(); }, 0);
		return () => window.clearTimeout(timer);
	}, [fetchTasks]);

	useEffect(() => {
		const hasRunning = tasks.some((t) => t.status === "RUNNING" || t.status === "PENDING");
		if (!hasRunning) return;
		const interval = setInterval(fetchTasks, 5000);
		return () => clearInterval(interval);
	}, [tasks, fetchTasks]);

	const handleServerChange = (serverId: string) => {
		const srv = servers.find((s) => s.id === serverId);
		setForm((p) => ({ ...p, serverId, targetPath: srv?.storagePath ?? "/root/downloads" }));
	};

	const handleSubmit = async () => {
		const trimmedFileName = form.fileName.trim();
		if (trimmedFileName && (trimmedFileName.includes("/") || trimmedFileName.includes("\\") || trimmedFileName.includes(".."))) {
			setMessage({ type: "error", text: "文件名只能填写单个文件名，不能包含路径分隔符或 .." });
			return;
		}
		setSubmitting(true); setMessage(null);
		try {
			const isBatch = form.batchMode;
			const batchUrls = isBatch ? form.batchText.split("\n").map((l) => l.trim()).filter(Boolean) : undefined;
			const payload: Record<string, unknown> = {
				url: isBatch ? batchUrls?.[0] ?? "" : form.url,
				serverId: form.serverId, targetPath: form.targetPath,
				fileName: form.fileName || undefined, category: form.category || undefined,
				maxSpeedKb: form.maxSpeedKb ? parseInt(form.maxSpeedKb, 10) : undefined,
				isBatch, batchUrls,
			};
			const res = await fetch("/api/downloads", {
				method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
			});
			const data = await res.json();
			if (res.ok) {
				setMessage({ type: "success", text: isBatch ? `批量下载已创建 (${batchUrls?.length ?? 0} 个链接)` : "下载任务已创建" });
				setForm({ url: "", serverId: servers[0]?.id ?? "", targetPath: defaultTargetPath, fileName: "", category: "", maxSpeedKb: "", batchMode: false, batchText: "" });
				setShowForm(false); fetchTasks();
			} else {
				setMessage({ type: "error", text: data.error || "创建失败" });
			}
		} catch { setMessage({ type: "error", text: "网络错误" }); }
		finally { setSubmitting(false); }
	};

	const handleAction = async (taskId: string, action: string) => {
		try {
			if (action === "cancel") {
				const res = await fetch(`/api/downloads?taskId=${taskId}`, { method: "DELETE" });
				if (res.ok) { setMessage({ type: "success", text: "任务已取消" }); fetchTasks(); }
			} else {
				const res = await fetch("/api/downloads", {
					method: "PATCH", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ taskId, action }),
				});
				if (res.ok) fetchTasks();
			}
		} catch {}
	};

	const handleGlobalSpeedLimit = async (kb: number) => {
		try {
			await fetch("/api/downloads", {
				method: "PATCH", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ globalMaxSpeedKb: kb }),
			});
		} catch {}
	};

	const filteredTasks = tasks
		.filter((t) => filter === "ALL" || t.status === filter)
		.filter((t) => !categoryFilter || (t.category ?? "") === categoryFilter);

	const runningCount = tasks.filter((t) => t.status === "RUNNING").length;
	const pendingCount = tasks.filter((t) => t.status === "PENDING").length;

	return (
		<div>
			{message && (
				<div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
					message.type === "success" ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200" : "border-rose-400/30 bg-rose-400/5 text-rose-200"
				}`}>
					{message.text}
					<button type="button" onClick={() => setMessage(null)} className="ml-3 text-current/50 hover:text-current">✕</button>
				</div>
			)}

			{/* Global Stats Bar */}
			{globalStat && (
				<div className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-wrap items-center gap-6 text-sm">
					<div>
						<span className="text-slate-500">全局下载速度</span>
						<span className="ml-2 text-cyan-300 font-mono">{formatSpeed(globalStat.downloadSpeed)}</span>
					</div>
					<div>
						<span className="text-slate-500">活跃任务</span>
						<span className="ml-2 text-white font-medium">{globalStat.numActive}</span>
					</div>
					<div>
						<span className="text-slate-500">等待中</span>
						<span className="ml-2 text-amber-200">{globalStat.numWaiting}</span>
					</div>
					<div className="ml-auto flex items-center gap-2">
						<span className="text-xs text-slate-500">全局限速</span>
						{[0, 1024, 5120, 10240].map((kb) => (
							<button key={kb} onClick={() => handleGlobalSpeedLimit(kb)}
								className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] transition"
							>
								{kb === 0 ? "不限" : `${kb >= 1024 ? (kb / 1024) + "M" : kb + "K"}`}
							</button>
						))}
					</div>
				</div>
			)}

			{/* Quick Stats */}
			{!globalStat && (runningCount > 0 || pendingCount > 0) && (
				<div className="mb-4 flex gap-3 text-xs text-slate-500">
					{runningCount > 0 && <span className="text-cyan-300">⬇ {runningCount} 个下载中</span>}
					{pendingCount > 0 && <span className="text-amber-300">⏳ {pendingCount} 个等待中</span>}
				</div>
			)}

			{/* Filter bar */}
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					{["ALL", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((f) => (
						<button key={f} type="button" onClick={() => setFilter(f)}
							className={`rounded-full border px-3 py-1.5 text-xs transition ${
								filter === f ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
							}`}
						>
							{f === "ALL" ? "全部" : statusLabel[f]}
						</button>
					))}
					<div className="w-px h-4 bg-white/10" />
					{categories.map((c) => (
						<button key={c.value} type="button" onClick={() => setCategoryFilter(categoryFilter === c.value ? null : c.value)}
							className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
								categoryFilter === c.value ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"
							}`}
						>
							{c.icon} {c.label}
						</button>
					))}
				</div>
				{canManage && (
					<button type="button" onClick={() => setShowForm(!showForm)}
						className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
					>
						{showForm ? "取消" : "+ 新建下载"}
					</button>
				)}
			</div>

			{/* Create form */}
			{showForm && canManage && (
				<div className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
					<h3 className="text-lg font-semibold text-white">新建下载任务</h3>

					{/* Batch mode toggle */}
					<div className="flex items-center gap-3">
						<button type="button" onClick={() => setForm((p) => ({ ...p, batchMode: !p.batchMode }))}
							className={`rounded-lg border px-3 py-1.5 text-xs transition ${
								form.batchMode ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"
							}`}
						>
							📋 批量模式
						</button>
						{form.batchMode && <span className="text-xs text-slate-500">每行一个链接</span>}
					</div>

					{form.batchMode ? (
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">下载链接（每行一个）</label>
							<textarea value={form.batchText} onChange={(e) => setForm((p) => ({ ...p, batchText: e.target.value }))}
								rows={6} placeholder="https://example.com/file1.zip&#10;magnet:?xt=urn:btih:...&#10;https://example.com/file2.zip"
								className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none focus:border-cyan-400/30 placeholder:text-white/20 resize-y"
							/>
						</div>
					) : (
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">下载链接</label>
							<input value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
								placeholder="https://example.com/file.zip 或 magnet:?xt=urn:btih:..."
								className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
							/>
							{form.url && <p className="text-[11px] text-slate-500">{urlTypeLabel(form.url)}</p>}
						</div>
					)}

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">目标 VPS</label>
							<select value={form.serverId} onChange={(e) => handleServerChange(e.target.value)}
								className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30"
							>
								{servers.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.host})</option>))}
							</select>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">保存路径</label>
							<input value={form.targetPath} onChange={(e) => setForm((p) => ({ ...p, targetPath: e.target.value }))}
								placeholder="/root/downloads" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
							/>
						</div>
					</div>

					<div className="grid gap-4 sm:grid-cols-3">
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">文件名（可选）</label>
							<input value={form.fileName} onChange={(e) => setForm((p) => ({ ...p, fileName: e.target.value }))}
								placeholder="留空自动" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
							/>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">分类</label>
							<select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
								className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30"
							>
								{categories.map((c) => (<option key={c.value} value={c.value}>{c.icon} {c.label}</option>))}
							</select>
						</div>
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-white/50 tracking-wide">限速 KB/s（可选）</label>
							<input value={form.maxSpeedKb} onChange={(e) => setForm((p) => ({ ...p, maxSpeedKb: e.target.value }))}
								type="number" placeholder="不限" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-cyan-400/30 placeholder:text-white/20"
							/>
						</div>
					</div>

					{form.url?.startsWith("magnet:") && (
						<div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-xs text-amber-200/70">
							🧲 磁力链接采用中转模式：本机 aria2 RPC 下载 → SFTP 传输到目标 VPS → 清理临时文件。支持实时进度追踪。
						</div>
					)}

					<div className="flex gap-3 pt-2">
						<button type="button" onClick={handleSubmit} disabled={submitting}
							className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
							{submitting ? "提交中…" : "开始下载"}
						</button>
					</div>
				</div>
			)}

			{/* Task list */}
			{loading ? (
				<div className="py-10 text-sm text-slate-500">加载中...</div>
			) : filteredTasks.length === 0 ? (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
					<div className="text-4xl mb-3">⬇️</div>
					<p className="text-sm text-slate-500">{filter === "ALL" ? "暂无下载任务" : `没有${statusLabel[filter]}的任务`}</p>
				</div>
			) : (
				<div className="space-y-2.5">
					{filteredTasks.map((task) => {
						const pct = computePct(task.completedBytes, task.totalBytes);
						return (
							<article key={task.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors duration-150">
								{/* Header row */}
								<div className="flex flex-wrap items-center gap-2 mb-2.5">
									<span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge[task.status] ?? ""}`}>
										{statusLabel[task.status] ?? task.status}
									</span>
									<span className="text-[11px] text-slate-500">{urlTypeLabel(task.url)}</span>
									{task.relayMode && <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[10px] text-amber-100">中转</span>}
									{task.category && <span className="text-[11px] text-slate-500">{categoryIcon[task.category] ?? "📦"} {task.category}</span>}
									{task.isBatch && <span className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 text-[10px] text-cyan-100">批量</span>}
								</div>

								{/* URL */}
								<div className="text-sm text-white font-mono break-all leading-relaxed">{task.url.length > 120 ? task.url.slice(0, 117) + "…" : task.url}</div>

								{/* Progress bar */}
								{task.status === "RUNNING" && task.totalBytes && parseInt(task.totalBytes) > 0 && (
									<div className="mt-2.5">
										<div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
											<span>{formatBytes(task.completedBytes)} / {formatBytes(task.totalBytes)}</span>
											<span>{pct}% · {formatSpeed(task.downloadSpeed)}</span>
										</div>
										<div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
											<div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
												style={{ width: `${pct}%` }}
											/>
										</div>
									</div>
								)}

								{/* Meta info */}
								<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
									<span>🖥 {task.server.name}</span>
									<span>📂 {task.targetPath}</span>
									{task.fileSize && <span>📦 {formatBytes(task.fileSize)}</span>}
									<span>🕒 {new Date(task.createdAt).toLocaleString("zh-CN")}</span>
									{task.creator && <span>👤 {task.creator.displayName ?? task.creator.username}</span>}
								</div>

								{/* Error */}
								{task.errorMessage && (
									<div className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-200">{task.errorMessage}</div>
								)}

								{/* Actions */}
								<div className="mt-3 flex gap-2">
									{task.status === "RUNNING" && task.aria2Gid && (
										<button type="button" onClick={() => handleAction(task.id, "pause")}
											className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-400/10 transition"
										>
											⏸ 暂停
										</button>
									)}
									{task.status === "PENDING" && task.aria2Gid && (
										<button type="button" onClick={() => handleAction(task.id, "resume")}
											className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/10 transition"
										>
											▶ 继续
										</button>
									)}
									{(task.status === "RUNNING" || task.status === "PENDING") && canManage && (
										<button type="button" onClick={() => handleAction(task.id, "cancel")}
											className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-400/10 transition"
										>
											✕ 取消
										</button>
									)}
									<button type="button" onClick={() => handleAction(task.id, "refresh")}
										className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-400 hover:bg-white/[0.05] transition"
									>
										🔄 刷新
									</button>
								</div>
							</article>
						);
					})}
				</div>
			)}
		</div>
	);
}
