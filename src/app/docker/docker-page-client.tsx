"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";

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

type DockerScope = {
	scope: "hub-host";
	socketPath: string;
	warning: string;
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

function getContainerName(t: (key: string) => string, container: Pick<Container, "Id" | "Names">) {
	return (container.Names?.[0] || container.Id?.slice(0, 12) || t("dockerPage.state.unknown")).replace(/^\//, "");
}

const KNOWN_DOCKER_STATES = ["running", "exited", "paused", "created", "restarting"] as const;
type KnownDockerState = (typeof KNOWN_DOCKER_STATES)[number];

function isKnownDockerState(state: string): state is KnownDockerState {
	return (KNOWN_DOCKER_STATES as readonly string[]).includes(state);
}

function stateLabel(t: (key: string) => string, state: string): string {
	if (isKnownDockerState(state)) return t(`dockerPage.state.${state}`);
	return state;
}

const stateColors: Record<string, string> = {
	running: "bg-emerald-500/10 text-emerald-400",
	exited: "bg-slate-700/50 text-slate-400",
	paused: "bg-amber-500/10 text-amber-400",
	created: "bg-[var(--accent-bg)] text-[var(--accent)]",
	restarting: "bg-orange-500/10 text-orange-400",
};

export default function DockerPage() {
	const { t } = useI18n();
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
	const [dockerScope, setDockerScope] = useState<DockerScope | null>(null);
	const closeRemovalDialog = useCallback(() => setPendingRemoval(null), []);
	const closeLogsDialog = useCallback(() => setLogsId(null), []);
	const removeCancelButtonRef = useRef<HTMLButtonElement | null>(null);
	const logsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
	const removalDialogRef = useDialogFocus<HTMLDivElement>({ open: pendingRemoval !== null, onClose: closeRemovalDialog, initialFocusRef: removeCancelButtonRef });
	const logsDialogRef = useDialogFocus<HTMLDivElement>({ open: logsId !== null, onClose: closeLogsDialog, initialFocusRef: logsCloseButtonRef });

	const fetchContainers = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/docker/containers");
			if (data.error) {
				setError(data.error);
				return;
			}
			if (data.dockerScope && typeof data.dockerScope === "object") {
				setDockerScope(data.dockerScope as DockerScope);
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
			setError(t("dockerPage.error.fetch"));
		} finally {
			setLoading(false);
		}
	}, [t]);

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
			setError(err instanceof Error ? err.message : t("dockerPage.error.action"));
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
			setLogs(t("dockerPage.error.logs"));
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
	}, [fetchContainers]);

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

	const projectCount = useMemo(() => grouped.length, [grouped]);
	const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
	const defaultSocket = t("dockerPage.scope.defaultSocket");
	const defaultWarning = t("dockerPage.scope.warning");
	const socketPath = dockerScope?.socketPath ?? defaultSocket;
	const scopeWarning = dockerScope?.warning ?? defaultWarning;
	const scopeSocketText = t("dockerPage.scope.socket").replace("{path}", socketPath);

	return (
		<PageShell>
			<PageHeader eyebrow={t("dockerPage.eyebrow")} title={t("dockerPage.title")} description={t("dockerPage.desc")} />
			<section
				aria-labelledby="docker-scope-title"
				data-tone="amber" className="mb-4 rounded-2xl border border-amber-400/25 p-4 text-sm text-amber-100 light:border-amber-300 light:bg-amber-50"
			>
				<h2 id="docker-scope-title" className="text-sm font-semibold">{t("dockerPage.scope.title")}</h2>
				<p className="mt-1 leading-relaxed">
					{scopeWarning}
				</p>
				<p className="mt-2 text-xs text-amber-200/80">
					{scopeSocketText}
				</p>
			</section>
			<div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mb-6">
				<span>{t("dockerPage.toolbar.compose")}</span>
				<span className="text-slate-600">·</span>
				<span>{t("dockerPage.toolbar.groupCount").replace("{count}", String(projectCount))}</span>
				<span className="text-slate-600">·</span>
				<span>{t("dockerPage.toolbar.ungroupedCount").replace("{count}", String(ungrouped.length))}</span>
			</div>
			<div className="flex flex-wrap items-center gap-3 mb-6">
				<button
					onClick={() => {
						setLoading(true);
						void fetchContainers();
					}}
					className="min-h-11 px-3 py-1.5 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition"
				>
					{t("dockerPage.refresh.list")}
				</button>
				<button
					onClick={() => {
						for (const container of runningContainers) void fetchStats(container.Id);
					}}
					className="min-h-11 px-3 py-1.5 text-xs font-medium bg-purple-500/10 text-purple-300 rounded-lg hover:bg-purple-500/20 transition"
				>
					{t("dockerPage.refresh.stats")}
				</button>
				<button
					onClick={() => setStatsAutoRefresh((v) => !v)}
					disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${statsAutoRefresh ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/50 text-slate-400"}`}
				>
					{statsAutoRefresh
						? t("dockerPage.autoRefreshOn").replace("{label}", refreshLabel)
						: refreshIntervalSeconds <= 0
							? t("dockerPage.autoRefreshOff")
							: t("dockerPage.autoRefreshPaused").replace("{label}", refreshLabel)}
				</button>
			</div>

			{error && <div className="mb-4 text-sm text-rose-400 bg-rose-500/10 rounded-lg px-4 py-3">{error}</div>}

			{loading ? (
				<div className="text-sm text-slate-500">{t("dockerPage.loading")}</div>
			) : containers.length === 0 ? (
				<div data-empty-state className="bg-white/[0.02]">
					{t("dockerPage.empty")}
				</div>
			) : (
				<div className="space-y-4">
					{grouped.map((group) => (
						<section key={group.project} data-card className="p-4">
							<div className="mb-3">
								<h2 className="text-sm font-medium text-white">{group.project}</h2>
								<p className="text-[11px] text-slate-500">{t("dockerPage.group.subtitle").replace("{count}", String(group.containers.length))}</p>
							</div>
							<div className="space-y-3">
								{group.containers.map((c) => {
									const stat = stats[c.Id];
									return (
										<div key={c.Id} className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
											<div className="flex items-center justify-between gap-3 mb-2">
												<div className="flex items-center gap-3 min-w-0">
													<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-slate-700/50 text-slate-400"}`}>
														{stateLabel(t, c.State)}
													</span>
													<span className="text-sm font-medium text-white truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
												</div>
												<span className="text-[10px] text-slate-500 truncate ml-3">{c.Image}</span>
											</div>
											<div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3">
												<span>{c.Status}</span>
												{c.Labels?.["com.docker.compose.service"] ? <span>{t("dockerPage.label.service").replace("{name}", c.Labels["com.docker.compose.service"])}</span> : null}
												{c.Labels?.["com.docker.compose.version"] ? <span>{t("dockerPage.label.version").replace("{version}", c.Labels["com.docker.compose.version"])}</span> : null}
											</div>
											{stat && (
												<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
													<div className="rounded-lg bg-cyan-500/10 px-2 py-1.5 text-cyan-300">{t("dockerPage.stat.cpu").replace("{percent}", stat.cpuPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-purple-500/10 px-2 py-1.5 text-purple-300">{t("dockerPage.stat.memory").replace("{used}", formatBytes(stat.memoryUsageBytes)).replace("{percent}", stat.memoryPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-emerald-300">{t("dockerPage.stat.netRx").replace("{bytes}", formatBytes(stat.networkRxBytes))}</div>
													<div className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-amber-300">{t("dockerPage.stat.netTx").replace("{bytes}", formatBytes(stat.networkTxBytes))}</div>
												</div>
											)}
											<div className="flex flex-wrap items-center gap-2">
												{c.State !== "running" && (
													<button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition disabled:opacity-50">{t("dockerPage.action.start")}</button>
												)}
												{c.State === "running" && (
													<>
														<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
														<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-white transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
													</>
												)}
												<button onClick={() => fetchLogs(c.Id)} className="min-h-11 px-2.5 py-1 text-[10px] bg-slate-700/50 light:bg-slate-200/50 text-[var(--text-secondary)] rounded-lg hover:bg-slate-700 light:hover:bg-slate-200 transition">{t("dockerPage.action.logs")}</button>
												<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50">{t("dockerPage.action.remove")}</button>
											</div>
										</div>
									);
								})}
							</div>
						</section>
					))}

					{ungrouped.length > 0 && (
						<section data-card className="p-4">
							<h2 className="text-sm font-medium text-white mb-3">{t("dockerPage.ungrouped.title")}</h2>
							<div className="space-y-3">
								{ungrouped.map((c) => (
									<div key={c.Id} className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
										<div className="flex items-center justify-between gap-3 mb-2">
											<div className="flex items-center gap-3 min-w-0">
												<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-slate-700/50 text-slate-400"}`}>
													{stateLabel(t, c.State)}
												</span>
												<span className="text-sm font-medium text-white truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
											</div>
											<span className="text-[10px] text-slate-500 truncate ml-3">{c.Image}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-3">
											<span>{c.Status}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{c.State !== "running" && <button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition disabled:opacity-50">{t("dockerPage.action.start")}</button>}
											{c.State === "running" && (
												<>
													<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
													<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-white transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
												</>
											)}
											<button onClick={() => fetchLogs(c.Id)} className="min-h-11 px-2.5 py-1 text-[10px] bg-slate-700/50 light:bg-slate-200/50 text-[var(--text-secondary)] rounded-lg hover:bg-slate-700 light:hover:bg-slate-200 transition">{t("dockerPage.action.logs")}</button>
											<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-rose-500/10 text-rose-400 rounded-lg hover:bg-rose-500/20 transition disabled:opacity-50">{t("dockerPage.action.remove")}</button>
										</div>
									</div>
								))}
							</div>
						</section>
					)}
				</div>
			)}

			{pendingRemoval && (
				<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeRemovalDialog}>
					<div
						ref={removalDialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby="docker-remove-confirm-title"
						className="w-full max-w-md mx-0 rounded-t-2xl border border-rose-400/20 bg-slate-950 p-5 shadow-2xl sm:mx-4 sm:rounded-2xl"
						onClick={(event) => event.stopPropagation()}
					>
						<h3 id="docker-remove-confirm-title" className="text-base font-semibold text-white">{t("dockerPage.removeDialog.title")}</h3>
						<p className="mt-3 text-sm text-[var(--text-secondary)]">
							{t("dockerPage.removeDialog.confirm").replace("{name}", getContainerName(t, pendingRemoval))}
						</p>
						<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<button
								ref={removeCancelButtonRef}
								type="button"
								onClick={closeRemovalDialog}
								className="min-h-11 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-white/[0.06]"
							>
								{t("dockerPage.removeDialog.cancel")}
							</button>
							<button
								type="button"
								onClick={() => void confirmRemoval()}
								disabled={actionLoading === pendingRemoval.Id}
								className="min-h-11 rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{t("dockerPage.removeDialog.confirmBtn")}
							</button>
						</div>
					</div>
				</div>
			)}

			{logsId && (
				<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeLogsDialog}>
					<div
						ref={logsDialogRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby="docker-logs-dialog-title"
						tabIndex={-1}
						className="flex w-full max-w-2xl mx-0 max-h-[92vh] flex-col rounded-t-2xl border border-white/[0.08] bg-slate-950 p-5 shadow-2xl sm:mx-4 sm:max-h-[80vh] sm:rounded-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<h3 id="docker-logs-dialog-title" className="text-sm font-medium text-white">{t("dockerPage.logsDialog.title").replace("{id}", logsId.slice(0, 12))}</h3>
							<button
								ref={logsCloseButtonRef}
								type="button"
								onClick={closeLogsDialog}
								aria-label={t("dockerPage.logsDialog.closeAria")}
								className="min-h-11 min-w-11 rounded-lg p-1 text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300 light:hover:bg-slate-100 light:hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-400/70"
							>
								<svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<pre className="flex-1 overflow-auto text-[11px] text-[var(--text-secondary)] bg-black/40 rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
					</div>
				</div>
			)}
		</PageShell>
	);
}
