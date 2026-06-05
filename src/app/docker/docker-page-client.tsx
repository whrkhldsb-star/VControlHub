"use client";

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

interface Container {
	Id: string;
	Names: string[];
	Image: string;
	State: string;
	Status: string;
	Ports: { IP: string; PrivatePort: number; PublicPort: number; Type: string }[];
	Labels?: Record<string, string>;
}

type ComposeGroup = {
	project: string;
	containers: Container[];
};

type ContainerStats = {
	id: string;
	name: string;
	cpuPercent: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
	memoryPercent: number;
	networkRxBytes: number;
	networkTxBytes: number;
	blockReadBytes: number;
	blockWriteBytes: number;
	pids: number;
};

function formatBytes(bytes: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return index === 0 ? `${Math.round(value)} ${units[index]}` : `${value.toFixed(1)} ${units[index]}`;
}

function getContainerName(container: Pick<Container, "Id" | "Names">) {
	return (container.Names?.[0] || container.Id?.slice(0, 12) || "未知容器").replace(/^\//, "");
}

export default function DockerPage() {
	const [containers, setContainers] = useState<Container[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [logsId, setLogsId] = useState<string | null>(null);
	const [logs, setLogs] = useState("");
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [stats, setStats] = useState<Record<string, ContainerStats>>({});
	const [statsAutoRefresh, setStatsAutoRefresh] = useState(false);
	const [pendingRemoval, setPendingRemoval] = useState<Container | null>(null);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);
	const [grouped, setGrouped] = useState<ComposeGroup[]>([]);
	const [ungrouped, setUngrouped] = useState<Container[]>([]);

	const fetchContainers = async () => {
		try {
			const data = await csrfFetch("/api/docker/containers");
			if (data.error) {
				setError(data.error);
				return;
			}
			if (data.data && Array.isArray(data.data)) {
				const nextContainers = data.data as Container[];
				setContainers(nextContainers);

				const groups = new Map<string, Container[]>();
				const loose: Container[] = [];
				for (const container of nextContainers) {
					const project = container.Labels?.["com.docker.compose.project"];
					if (project) {
						const list = groups.get(project) ?? [];
						list.push(container);
						groups.set(project, list);
					} else {
						loose.push(container);
					}
				}

				setGrouped(
					Array.from(groups.entries())
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([project, groupContainers]) => ({ project, containers: groupContainers })),
				);
				setUngrouped(loose);
			} else if (Array.isArray(data)) {
				setContainers(data);
			}
		} catch {
			setError("无法连接 Docker API");
		} finally {
			setLoading(false);
		}
	};

	const handleAction = async (container: Container, action: "start" | "stop" | "restart" | "remove") => {
		const id = container.Id;
		setActionLoading(id);
		setError("");
		try {
			await csrfFetch("/api/docker/containers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, action }),
			});
			await fetchContainers();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Docker 操作失败");
		} finally {
			setActionLoading(null);
		}
	};

	const requestRemoval = (container: Container) => {
		setPendingRemoval(container);
		setError("");
	};

	const confirmRemoval = async () => {
		if (!pendingRemoval) return;
		const container = pendingRemoval;
		setPendingRemoval(null);
		await handleAction(container, "remove");
	};

	const fetchLogs = async (id: string) => {
		setLogsId(id);
		try {
			const data = await csrfFetch(`/api/docker/containers?logs=${id}&tail=50`);
			setLogs(typeof data.data === "string" ? data.data : JSON.stringify(data.data, null, 2));
		} catch {
			setLogs("获取日志失败");
		}
	};

	const fetchStats = async (id: string) => {
		try {
			const data = await csrfFetch(`/api/docker/containers?stats=${id}`);
			if (data.data) {
				setStats((prev) => ({ ...prev, [id]: data.data as ContainerStats }));
			}
		} finally {
			// no-op
		}
	};

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchContainers();
		}, 0);
		return () => window.clearTimeout(timer);
	}, []);

	const runningContainers = useMemo(() => containers.filter((container) => container.State === "running").slice(0, 12), [containers]);

	useEffect(() => {
		const onStorage = () => setRefreshIntervalSeconds(getRefreshIntervalFromStorage(globalThis.localStorage, 30));
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, []);

	useEffect(() => {
		for (const container of runningContainers) {
			void fetchStats(container.Id);
		}
	}, [runningContainers]);

	useEffect(() => {
		if (!statsAutoRefresh || refreshIntervalSeconds <= 0 || runningContainers.length === 0) return;
		const id = setInterval(() => {
			for (const container of runningContainers) {
				void fetchStats(container.Id);
			}
		}, refreshIntervalSeconds * 1000);
		return () => clearInterval(id);
	}, [refreshIntervalSeconds, runningContainers, statsAutoRefresh]);

	const stateColors: Record<string, string> = {
		running: "bg-emerald-500/10 text-emerald-400",
		exited: "bg-slate-700/50 text-slate-400",
		paused: "bg-amber-500/10 text-amber-400",
		created: "bg-blue-500/10 text-blue-400",
		restarting: "bg-orange-500/10 text-orange-400",
	};

	const projectCount = useMemo(() => grouped.length, [grouped]);

	return (
		<PageShell>
			<h1 className="text-2xl font-bold mb-1">Docker 容器</h1>
			<p className="text-slate-400 light:text-slate-600 mb-4">管理本机 Docker 容器</p>
			<div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mb-6">
				<span>支持按 compose 项目浏览</span>
				<span className="text-slate-600">·</span>
				<span>{projectCount} 个编排组</span>
				<span className="text-slate-600">·</span>
				<span>{ungrouped.length} 个独立容器</span>
			</div>
			<div className="flex flex-wrap items-center gap-3 mb-6">
				<button
					onClick={() => {
						setLoading(true);
						void fetchContainers();
					}}
					className="px-3 py-1.5 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition"
				>
					刷新列表
				</button>
				<button
					onClick={() => {
						for (const container of runningContainers) void fetchStats(container.Id);
					}}
					className="px-3 py-1.5 text-xs font-medium bg-purple-500/10 text-purple-300 rounded-lg hover:bg-purple-500/20 transition"
				>
					刷新统计
				</button>
				<button
					onClick={() => setStatsAutoRefresh((v) => !v)}
					disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					className={`px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${statsAutoRefresh ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/50 text-slate-400"}`}
				>
					{statsAutoRefresh ? `● 统计自动刷新 (${getRefreshIntervalLabel(refreshIntervalSeconds)})` : refreshIntervalSeconds <= 0 ? "统计自动刷新已关闭" : `统计自动刷新 (${getRefreshIntervalLabel(refreshIntervalSeconds)})`}
				</button>
			</div>

			{error && <div className="mb-4 text-sm text-rose-400 bg-rose-500/10 rounded-lg px-4 py-3">{error}</div>}

			{loading ? (
				<div className="text-sm text-slate-500">加载中...</div>
			) : containers.length === 0 ? (
				<div className="text-sm text-slate-500 bg-white/[0.02] rounded-xl border border-white/[0.06] p-8 text-center">
					未发现 Docker 容器，或 Docker 服务未运行
				</div>
			) : (
				<div className="space-y-4">
					{grouped.map((group) => (
						<section key={group.project} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
							<div className="mb-3">
								<h2 className="text-sm font-medium text-white light:text-slate-900">{group.project}</h2>
								<p className="text-[11px] text-slate-500">compose 项目 · {group.containers.length} 个容器</p>
							</div>
							<div className="space-y-3">
								{group.containers.map((c) => {
									const stat = stats[c.Id];
									return (
										<div key={c.Id} className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
											<div className="flex items-center justify-between gap-3 mb-2">
												<div className="flex items-center gap-3 min-w-0">
													<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-slate-700/50 text-slate-400"}`}>
														{c.State}
													</span>
													<span className="text-sm font-medium text-white light:text-slate-900 truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
												</div>
												<span className="text-[10px] text-slate-500 truncate ml-3">{c.Image}</span>
											</div>
											<div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3">
												<span>{c.Status}</span>
												{c.Labels?.["com.docker.compose.service"] ? <span>service: {c.Labels["com.docker.compose.service"]}</span> : null}
												{c.Labels?.["com.docker.compose.version"] ? <span>v{c.Labels["com.docker.compose.version"]}</span> : null}
											</div>
											{stat && (
												<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
													<div className="rounded-lg bg-cyan-500/10 px-2 py-1.5 text-cyan-300 light:text-cyan-700">CPU {stat.cpuPercent.toFixed(1)}%</div>
													<div className="rounded-lg bg-purple-500/10 px-2 py-1.5 text-purple-300">内存 {formatBytes(stat.memoryUsageBytes)} / {stat.memoryPercent.toFixed(1)}%</div>
													<div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-emerald-300 light:text-emerald-700">↓ {formatBytes(stat.networkRxBytes)}</div>
													<div className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-amber-300">↑ {formatBytes(stat.networkTxBytes)}</div>
												</div>
											)}
											<div className="flex flex-wrap items-center gap-2">
												{c.State !== "running" && (
													<button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition disabled:opacity-50">启动</button>
												)}
												{c.State === "running" && (
													<>
														<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition disabled:opacity-50">停止</button>
														<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition disabled:opacity-50">重启</button>
													</>
												)}
												<button onClick={() => fetchLogs(c.Id)} className="px-2.5 py-1 text-[10px] bg-slate-700/50 light:bg-slate-200/50 text-slate-300 light:text-slate-700 rounded-lg hover:bg-slate-700 light:hover:bg-slate-200 transition">日志</button>
												<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50">删除</button>
											</div>
										</div>
									);
								})}
							</div>
						</section>
					))}

					{ungrouped.length > 0 && (
						<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
							<h2 className="text-sm font-medium text-white light:text-slate-900 mb-3">独立容器</h2>
							<div className="space-y-3">
								{ungrouped.map((c) => (
									<div key={c.Id} className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
										<div className="flex items-center justify-between gap-3 mb-2">
											<div className="flex items-center gap-3 min-w-0">
												<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-slate-700/50 text-slate-400"}`}>
													{c.State}
												</span>
												<span className="text-sm font-medium text-white light:text-slate-900 truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
											</div>
											<span className="text-[10px] text-slate-500 truncate ml-3">{c.Image}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3">
											<span>{c.Status}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{c.State !== "running" && <button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition disabled:opacity-50">启动</button>}
											{c.State === "running" && (
												<>
													<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition disabled:opacity-50">停止</button>
													<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition disabled:opacity-50">重启</button>
												</>
											)}
											<button onClick={() => fetchLogs(c.Id)} className="px-2.5 py-1 text-[10px] bg-slate-700/50 light:bg-slate-200/50 text-slate-300 light:text-slate-700 rounded-lg hover:bg-slate-700 light:hover:bg-slate-200 transition">日志</button>
											<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="px-2.5 py-1 text-[10px] bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50">删除</button>
										</div>
									</div>
								))}
							</div>
						</section>
					)}
				</div>
			)}

			{pendingRemoval && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="presentation" onClick={() => setPendingRemoval(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="docker-remove-confirm-title"
						className="w-full max-w-md mx-4 rounded-2xl border border-rose-400/20 bg-slate-950 light:bg-white p-5 shadow-2xl"
						onClick={(event) => event.stopPropagation()}
					>
						<h3 id="docker-remove-confirm-title" className="text-base font-semibold text-white light:text-slate-900">确认删除容器</h3>
						<p className="mt-3 text-sm text-slate-300 light:text-slate-700">
							即将删除容器 <span className="font-mono text-rose-200 light:text-rose-800">{getContainerName(pendingRemoval)}</span>。此操作不可恢复，请确认没有误选生产容器。
						</p>
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setPendingRemoval(null)}
								className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 light:text-slate-700 transition hover:bg-white/[0.06]"
							>
								取消
							</button>
							<button
								type="button"
								onClick={() => void confirmRemoval()}
								disabled={actionLoading === pendingRemoval.Id}
								className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
							>
								确认删除
							</button>
						</div>
					</div>
				</div>
			)}

			{logsId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setLogsId(null)}>
					<div className="w-full max-w-2xl mx-4 bg-slate-950 light:bg-white border border-white/[0.08] rounded-2xl p-5 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center justify-between mb-3">
							<h3 className="text-sm font-medium text-white light:text-slate-900">容器日志 — {logsId.slice(0, 12)}</h3>
							<button onClick={() => setLogsId(null)} className="text-slate-500 hover:text-slate-300">
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<pre className="flex-1 overflow-auto text-[11px] text-slate-300 light:text-slate-700 bg-black/40 rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
					</div>
				</div>
			)}
		</PageShell>
	);
}
