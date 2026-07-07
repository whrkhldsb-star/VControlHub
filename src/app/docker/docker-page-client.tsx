"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { DockerResourcesPanel } from "./docker-resources-panel";

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
	running: "bg-[var(--success-bg)] text-[var(--success)]",
	exited: "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]",
	paused: "bg-[var(--warning-bg)] text-[var(--warning)]",
	created: "bg-[var(--accent-bg)] text-[var(--accent)]",
	restarting: "bg-[var(--warning-bg)] text-[var(--warning)]",
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
	const refreshIntervalSeconds = useRefreshInterval(30);
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
			// Failed to fetch container logs — show an error message in the logs panel.
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
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow={t("dockerPage.eyebrow")} title={t("dockerPage.title")} description={t("dockerPage.desc")} />
			<section
				aria-labelledby="docker-scope-title"
				data-tone="amber" className="mb-4 rounded-2xl border border-[var(--warning-border)] p-4 text-sm text-[var(--warning)] light:border-[var(--warning-border)] light:bg-[var(--warning)]"
			>
				<h2 id="docker-scope-title" className="text-sm font-semibold">{t("dockerPage.scope.title")}</h2>
				<p className="mt-1 leading-relaxed">
					{scopeWarning}
				</p>
				<p className="mt-2 text-xs text-[var(--warning)]/80">
					{scopeSocketText}
				</p>
			</section>
			<div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)] mb-6">
				<span>{t("dockerPage.toolbar.compose")}</span>
				<span className="text-[var(--text-muted)]">·</span>
				<span>{t("dockerPage.toolbar.groupCount").replace("{count}", String(projectCount))}</span>
				<span className="text-[var(--text-muted)]">·</span>
				<span>{t("dockerPage.toolbar.ungroupedCount").replace("{count}", String(ungrouped.length))}</span>
			</div>
			<div className="flex flex-wrap items-center gap-3 mb-6">
				<button
					onClick={() => {
						setLoading(true);
						void fetchContainers();
					}}
					className="min-h-11 px-3 py-1.5 text-xs font-medium bg-[var(--color-action)]/10 text-[var(--color-action)] rounded-lg hover:bg-[var(--color-action)]/20 transition"
				>
					{t("dockerPage.refresh.list")}
				</button>
				<button
					onClick={() => {
						for (const container of runningContainers) void fetchStats(container.Id);
					}}
					className="min-h-11 px-3 py-1.5 text-xs font-medium bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-bg)] transition"
				>
					{t("dockerPage.refresh.stats")}
				</button>
				<button
					onClick={() => setStatsAutoRefresh((v) => !v)}
					disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${statsAutoRefresh ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}
				>
					{statsAutoRefresh
						? t("dockerPage.autoRefreshOn").replace("{label}", refreshLabel)
						: refreshIntervalSeconds <= 0
							? t("dockerPage.autoRefreshOff")
							: t("dockerPage.autoRefreshPaused").replace("{label}", refreshLabel)}
				</button>
			</div>

			{error && <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-bg)] rounded-lg px-4 py-3">{error}</div>}

			<DockerResourcesPanel />

			{loading ? (
				<div className="text-sm text-[var(--text-muted)]">{t("dockerPage.loading")}</div>
			) : containers.length === 0 ? (
				<div data-empty-state className="bg-[var(--surface)]/[0.04]">
					{t("dockerPage.empty")}
				</div>
			) : (
				<div className="space-y-4">
					{grouped.map((group) => (
						<section key={group.project} data-card className="p-4">
							<div className="mb-3">
								<h2 className="text-sm font-medium text-[var(--text-primary)]">{group.project}</h2>
								<p className="text-[11px] text-[var(--text-muted)]">{t("dockerPage.group.subtitle").replace("{count}", String(group.containers.length))}</p>
							</div>
							<div className="space-y-3">
								{group.containers.map((c) => {
									const stat = stats[c.Id];
									return (
										<div key={c.Id} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-4">
											<div className="flex items-center justify-between gap-3 mb-2">
												<div className="flex items-center gap-3 min-w-0">
													<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
														{stateLabel(t, c.State)}
													</span>
													<span className="text-sm font-medium text-[var(--text-primary)] truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
												</div>
												<span className="text-[10px] text-[var(--text-muted)] truncate ml-3">{c.Image}</span>
											</div>
											<div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)] mb-3">
												<span>{c.Status}</span>
												{c.Labels?.["com.docker.compose.service"] ? <span>{t("dockerPage.label.service").replace("{name}", c.Labels["com.docker.compose.service"])}</span> : null}
												{c.Labels?.["com.docker.compose.version"] ? <span>{t("dockerPage.label.version").replace("{version}", c.Labels["com.docker.compose.version"])}</span> : null}
											</div>
											{stat && (
												<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
													<div className="rounded-lg bg-[var(--color-action)]/10 px-2 py-1.5 text-[var(--color-action)]">{t("dockerPage.stat.cpu").replace("{percent}", stat.cpuPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-[var(--accent)]">{t("dockerPage.stat.memory").replace("{used}", formatBytes(stat.memoryUsageBytes)).replace("{percent}", stat.memoryPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-[var(--success-bg)] px-2 py-1.5 text-[var(--success)]">{t("dockerPage.stat.netRx").replace("{bytes}", formatBytes(stat.networkRxBytes))}</div>
													<div className="rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-[var(--warning)]">{t("dockerPage.stat.netTx").replace("{bytes}", formatBytes(stat.networkTxBytes))}</div>
												</div>
											)}
											<div className="flex flex-wrap items-center gap-2">
												{c.State !== "running" && (
													<button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--success-bg)] text-[var(--success)] rounded-lg hover:bg-[var(--success-bg)] transition disabled:opacity-50">{t("dockerPage.action.start")}</button>
												)}
												{c.State === "running" && (
													<>
														<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg hover:bg-[var(--warning-bg)] transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
														<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-[var(--text-primary)] transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
													</>
												)}
												<button onClick={() => fetchLogs(c.Id)} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--surface-hover)]/50 light:bg-[var(--surface)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface)] transition">{t("dockerPage.action.logs")}</button>
												<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--danger-bg)] text-[var(--danger)] rounded-lg hover:bg-[var(--danger-bg)] transition disabled:opacity-50">{t("dockerPage.action.remove")}</button>
											</div>
										</div>
									);
								})}
							</div>
						</section>
					))}

					{ungrouped.length > 0 && (
						<section data-card className="p-4">
							<h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">{t("dockerPage.ungrouped.title")}</h2>
							<div className="space-y-3">
								{ungrouped.map((c) => (
									<div key={c.Id} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-4">
										<div className="flex items-center justify-between gap-3 mb-2">
											<div className="flex items-center gap-3 min-w-0">
												<span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stateColors[c.State] || "bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
													{stateLabel(t, c.State)}
												</span>
												<span className="text-sm font-medium text-[var(--text-primary)] truncate">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//, "")}</span>
											</div>
											<span className="text-[10px] text-[var(--text-muted)] truncate ml-3">{c.Image}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)] mb-3">
											<span>{c.Status}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{c.State !== "running" && <button onClick={() => handleAction(c, "start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--success-bg)] text-[var(--success)] rounded-lg hover:bg-[var(--success-bg)] transition disabled:opacity-50">{t("dockerPage.action.start")}</button>}
											{c.State === "running" && (
												<>
													<button onClick={() => handleAction(c, "stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg hover:bg-[var(--warning-bg)] transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
													<button onClick={() => handleAction(c, "restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-[var(--text-primary)] transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
												</>
											)}
											<button onClick={() => fetchLogs(c.Id)} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--surface-hover)]/50 light:bg-[var(--surface)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface)] transition">{t("dockerPage.action.logs")}</button>
											<button onClick={() => requestRemoval(c)} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--danger-bg)] text-[var(--danger)] rounded-lg hover:bg-[var(--danger-bg)] transition disabled:opacity-50">{t("dockerPage.action.remove")}</button>
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
						className="w-full max-w-md mx-0 rounded-t-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-5 shadow-2xl sm:mx-4 sm:rounded-2xl"
						onClick={(event) => event.stopPropagation()}
					>
						<h3 id="docker-remove-confirm-title" className="text-base font-semibold text-[var(--text-primary)]">{t("dockerPage.removeDialog.title")}</h3>
						<p className="mt-3 text-sm text-[var(--text-secondary)]">
							{t("dockerPage.removeDialog.confirm").replace("{name}", getContainerName(t, pendingRemoval))}
						</p>
						<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<button
								ref={removeCancelButtonRef}
								type="button"
								onClick={closeRemovalDialog}
								className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]"
							>
								{t("dockerPage.removeDialog.cancel")}
							</button>
							<button
								type="button"
								onClick={() => void confirmRemoval()}
								disabled={actionLoading === pendingRemoval.Id}
								className="min-h-11 rounded-lg bg-[var(--danger-bg)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:cursor-not-allowed disabled:opacity-50"
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
						className="flex w-full max-w-2xl mx-0 max-h-[92vh] flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl sm:mx-4 sm:max-h-[80vh] sm:rounded-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<h3 id="docker-logs-dialog-title" className="text-sm font-medium text-[var(--text-primary)]">{t("dockerPage.logsDialog.title").replace("{id}", logsId.slice(0, 12))}</h3>
							<button
								ref={logsCloseButtonRef}
								type="button"
								onClick={closeLogsDialog}
								aria-label={t("dockerPage.logsDialog.closeAria")}
								className="min-h-11 min-w-11 rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface)]/[0.10] hover:text-[var(--text-secondary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-disabled)] focus:outline-none focus:ring-[var(--color-action-ring)]"
							>
								<svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<pre className="flex-1 overflow-auto text-[11px] text-[var(--text-secondary)] bg-black/50 rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
					</div>
				</div>
			)}
		</PageShell>
	);
}
