"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { DockerResourcesPanel } from "./docker-resources-panel";
import {
	type ComposeGroup,
	type Container,
	type ContainerStats,
	type DockerScope,
	type ServerOption,
	formatBytes,
	getContainerName,
	stateColors,
	stateLabel,
} from "./docker-helpers";


export default function DockerPage({ initialServers }: { initialServers: { id: string; name: string; host: string }[] }) {
	const { t } = useI18n();
	const [containers, setContainers] = useState<Container[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [logsId, setLogsId] = useState<string | null>(null);
	const [logs, setLogs] = useState("");
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [projectActionLoading, setProjectActionLoading] = useState<string | null>(null);
	const [projectMessage, setProjectMessage] = useState<string>("");
	const [stats, setStats] = useState<Record<string, ContainerStats>>({});
	const [statsAutoRefresh, setStatsAutoRefresh] = useState(false);
	const [pendingRemoval, setPendingRemoval] = useState<Container | null>(null);
	const [pendingProjectDown, setPendingProjectDown] = useState<string | null>(null);
	const refreshIntervalSeconds = useRefreshInterval(30);
	const [grouped, setGrouped] = useState<ComposeGroup[]>([]);
	const [ungrouped, setUngrouped] = useState<Container[]>([]);
	const [dockerScope, setDockerScope] = useState<DockerScope | null>(null);
	const [serverList] = useState<ServerOption[]>(initialServers);
	const [selectedServerId, setSelectedServerId] = useState<string>(""); //"" = hub-host
	const closeRemovalDialog = useCallback(() => setPendingRemoval(null), []);
	const closeLogsDialog = useCallback(() => setLogsId(null), []);
	const removeCancelButtonRef = useRef<HTMLButtonElement | null>(null);
	const logsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
	const removalDialogRef = useDialogFocus<HTMLDivElement>({ open: pendingRemoval !== null, onClose: closeRemovalDialog, initialFocusRef: removeCancelButtonRef });
	const logsDialogRef = useDialogFocus<HTMLDivElement>({ open: logsId !== null, onClose: closeLogsDialog, initialFocusRef: logsCloseButtonRef });
	const fetchingStatsRef = useRef<Set<string>>(new Set());

	const fetchContainers = useCallback(async () => {
		try {
			const url = selectedServerId
				? `/api/docker/containers?serverId=${encodeURIComponent(selectedServerId)}`
				:"/api/docker/containers";
			const data = await csrfFetch(url);
			if (data.error) {
				setError(data.error);
				return;
			}
			if (data.dockerScope && typeof data.dockerScope ==="object") {
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
	}, [t, selectedServerId]);

	const handleAction = async (container: Container, action:"start" |"stop" |"restart" |"remove") => {
		const id = container.Id;
		setActionLoading(id);
		setError("");
		try {
			const data = await csrfFetch<Record<string, unknown>>("/api/docker/containers", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({ id, action, ...(selectedServerId ? { serverId: selectedServerId } : {}) }),
			});
			if (data && typeof data ==="object" && data.ok === false) {
				const msg =
					typeof data.message ==="string"
						? data.message
						: t("dockerPage.error.action");
				setError(msg);
				return;
			}
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
		await handleAction(container,"remove");
	};

	const handleProjectAction = async (
		project: string,
		action:"up" |"down" |"start" |"stop" |"restart" |"ps",
	) => {
		if (action ==="down") {
			// Destructive: use in-app ConfirmDialog (not browser window.confirm).
			setPendingProjectDown(project);
			setError("");
			return;
		}
		await runProjectAction(project, action);
	};

	const runProjectAction = async (
		project: string,
		action:"up" |"down" |"start" |"stop" |"restart" |"ps",
	) => {
		setProjectActionLoading(`${project}:${action}`);
		setError("");
		setProjectMessage("");
		try {
			const data = await csrfFetch("/api/docker/compose", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({
					project,
					action,
					...(selectedServerId ? { serverId: selectedServerId } : {}),
				}),
			});
			const modeLabel =
				data.mode ==="compose-cli"
					? t("dockerPage.project.modeCli")
					: t("dockerPage.project.modeFallback");
			const actionLabelKey = `dockerPage.project.${action}` as const;
			const actionLabel = t(actionLabelKey) !== actionLabelKey ? t(actionLabelKey) : action;
			const msg = typeof data.message ==="string" ? data.message : t("dockerPage.project.success")
				.replace("{project}", project)
				.replace("{message}", actionLabel);
			setProjectMessage(`${msg} (${modeLabel})`);
			if (action !=="ps") {
				await fetchContainers();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("dockerPage.project.failed"));
		} finally {
			setProjectActionLoading(null);
		}
	};

	const confirmProjectDown = async () => {
		if (!pendingProjectDown) return;
		const project = pendingProjectDown;
		setPendingProjectDown(null);
		await runProjectAction(project,"down");
	};


	const fetchLogs = async (id: string) => {
		setLogsId(id);
		try {
			const params = new URLSearchParams({ logs: id, tail:"50" });
		if (selectedServerId) params.set("serverId", selectedServerId);
		const data = await csrfFetch(`/api/docker/containers?${params}`);
			setLogs(typeof data.data ==="string" ? data.data : JSON.stringify(data.data, null, 2));
		} catch {
			// Failed to fetch container logs — show an error message in the logs panel.
			setLogs(t("dockerPage.error.logs"));
		}
	};

	const fetchStats = async (id: string) => {
		if (fetchingStatsRef.current.has(id)) return;
		fetchingStatsRef.current.add(id);
		try {
			const statsParams = new URLSearchParams({ stats: id });
		if (selectedServerId) statsParams.set("serverId", selectedServerId);
		const data = await csrfFetch(`/api/docker/containers?${statsParams}`);
			if (data.data) {
				setStats((prev) => ({ ...prev, [id]: data.data as ContainerStats }));
			}
		} finally {
			fetchingStatsRef.current.delete(id);
		}
	};

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setLoading(true);
			setContainers([]);
			setStats({});
			setGrouped([]);
			setUngrouped([]);
			void fetchContainers();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchContainers]);

	const runningContainers = useMemo(() => containers.filter((container) => container.State ==="running").slice(0, 12), [containers]);

	useEffect(() => {
		for (const container of runningContainers) {
			// Skip if stats already fetched for this container
			if (stats[container.Id]) continue;
			void fetchStats(container.Id);
		}
	}, [runningContainers]); // eslint-disable-line react-hooks/exhaustive-deps

	useVisibilityInterval(() => {
			for (const container of runningContainers) {
				void fetchStats(container.Id);
			}
	}, statsAutoRefresh && refreshIntervalSeconds > 0 && runningContainers.length > 0 ? refreshIntervalSeconds * 1000 : null);

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
			{/* FEAT-P0-2: Server selector for remote Docker management */}
			{serverList.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
					<label className="text-xs font-medium text-[var(--text-secondary)]" htmlFor="docker-server-select">
						{t("dockerPage.scope.serverSelect")}
					</label>
					<select
						id="docker-server-select"
						value={selectedServerId}
						onChange={(e) => setSelectedServerId(e.target.value)}
						data-input className="min-h-11 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)] focus:outline-none"
					>
						<option value="">{t("dockerPage.scope.hubHost")}</option>
						{serverList.map((s) => (
							<option key={s.id} value={s.id}>{s.name} ({s.host})</option>
						))}
					</select>
					{selectedServerId && (
						<span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--accent)]">
							{t("dockerPage.scope.remoteActive")}
						</span>
					)}
				</div>
			)}
			<section
				aria-labelledby="docker-scope-title"
				className="mb-4 rounded-2xl border border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_45%,var(--surface))] p-4 text-sm text-[var(--warning)]"
			>
				<h2 id="docker-scope-title" className="text-sm font-semibold">{t("dockerPage.scope.title")}</h2>
				<p className="mt-1 leading-relaxed">
					{scopeWarning}
				</p>
				<p className="mt-2 text-xs text-[var(--warning)]/80">
					{scopeSocketText}
				</p>
			</section>
			<div data-toolbar className="mb-4 flex flex-wrap items-center gap-2 p-2.5 text-xs text-[var(--text-muted)]">
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1 font-medium text-[var(--text-secondary)]">{t("dockerPage.toolbar.compose")}</span>
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-1">{t("dockerPage.toolbar.groupCount").replace("{count}", String(projectCount))}</span>
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-1">{t("dockerPage.toolbar.ungroupedCount").replace("{count}", String(ungrouped.length))}</span>
			</div>
			<div className="mb-6 flex flex-wrap items-center gap-2">
				<button
					onClick={() => {
						setLoading(true);
						void fetchContainers();
					}}
					className="min-h-11 rounded-xl bg-[var(--accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-hover)] hover:text-[var(--on-accent)]"
				>
					{t("dockerPage.refresh.list")}
				</button>
				<button
					onClick={() => {
						for (const container of runningContainers) void fetchStats(container.Id);
					}}
					className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
				>
					{t("dockerPage.refresh.stats")}
				</button>
				<button
					onClick={() => setStatsAutoRefresh((v) => !v)}
					disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					className={`min-h-11 rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${statsAutoRefresh ?"border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" :"border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"}`}
				>
					{statsAutoRefresh
						? t("dockerPage.autoRefreshOn").replace("{label}", refreshLabel)
						: refreshIntervalSeconds <= 0
							? t("dockerPage.autoRefreshOff")
							: t("dockerPage.autoRefreshPaused").replace("{label}", refreshLabel)}
				</button>
			</div>

			{error && <div className="mb-4 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
			{projectMessage && <div className="mb-4 rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]">{projectMessage}</div>}

			<DockerResourcesPanel serverId={selectedServerId} />

			{loading ? (
				<div className="text-sm text-[var(--text-muted)]">{t("dockerPage.loading")}</div>
			) : containers.length === 0 ? (
				<EmptyState text={t("dockerPage.empty")} variant="boxed" />
			) : (
				<div className="space-y-4">
					{grouped.map((group) => (
						<section key={group.project} data-card className="p-4">
							<div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div>
									<h2 className="text-sm font-medium text-[var(--text-primary)]">{group.project}</h2>
									<p className="text-[11px] text-[var(--text-muted)]">
										{t("dockerPage.group.subtitle").replace("{count}", String(group.containers.length))}
										{" ·"}
									{t("dockerPage.project.runningOf")
										.replace("{running}", String(group.containers.filter((c) => c.State ==="running").length))
										.replace("{total}", String(group.containers.length))}
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2" aria-label={t("dockerPage.project.actions")}>
									{(
										[
											["ps","dockerPage.project.ps","bg-[var(--surface-elevated)] text-[var(--text-secondary)] border border-[var(--border)]"],
											["up","dockerPage.project.up","bg-[var(--success-bg)] text-[var(--success)]"],
											["start","dockerPage.project.start","bg-[var(--success-bg)] text-[var(--success)]"],
											["stop","dockerPage.project.stop","bg-[var(--warning-bg)] text-[var(--warning)]"],
											["restart","dockerPage.project.restart","bg-[var(--accent-bg)] text-[var(--accent)]"],
											["down","dockerPage.project.down","bg-[var(--danger-bg)] text-[var(--danger)]"],
										] as const
									).map(([action, labelKey, cls]) => {
										const busyKey = `${group.project}:${action}`;
										const busy = projectActionLoading === busyKey;
										return (
											<button
												key={action}
												type="button"
												onClick={() => void handleProjectAction(group.project, action)}
												disabled={projectActionLoading !== null}
												className={`min-h-11 rounded-lg px-2.5 py-1 text-[10px] font-medium transition disabled:opacity-50 ${cls}`}
											>
												{busy ? t("dockerPage.project.busy") : t(labelKey)}
											</button>
										);
									})}
								</div>
							</div>
							<div className="space-y-3">
								{group.containers.map((c) => {
									const stat = stats[c.Id];
									return (
										<div key={c.Id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
											<div className="mb-2 flex items-center justify-between gap-3">
												<div className="flex min-w-0 items-center gap-3">
													<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stateColors[c.State] ||"bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
														{stateLabel(t, c.State)}
													</span>
													<span className="truncate text-sm font-medium text-[var(--text-primary)]">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//,"")}</span>
												</div>
												<span className="ml-3 truncate text-[10px] text-[var(--text-muted)]">{c.Image}</span>
											</div>
											<div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
												<span>{c.Status}</span>
												{c.Labels?.["com.docker.compose.service"] ? <span>{t("dockerPage.label.service").replace("{name}", c.Labels["com.docker.compose.service"])}</span> : null}
												{c.Labels?.["com.docker.compose.version"] ? <span>{t("dockerPage.label.version").replace("{version}", c.Labels["com.docker.compose.version"])}</span> : null}
											</div>
											{stat && (
												<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
													<div className="rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-[var(--accent)]">{t("dockerPage.stat.cpu").replace("{percent}", stat.cpuPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-[var(--accent-bg)] px-2 py-1.5 text-[var(--accent)]">{t("dockerPage.stat.memory").replace("{used}", formatBytes(stat.memoryUsageBytes)).replace("{percent}", stat.memoryPercent.toFixed(1))}</div>
													<div className="rounded-lg bg-[var(--success-bg)] px-2 py-1.5 text-[var(--success)]">{t("dockerPage.stat.netRx").replace("{bytes}", formatBytes(stat.networkRxBytes))}</div>
													<div className="rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-[var(--warning)]">{t("dockerPage.stat.netTx").replace("{bytes}", formatBytes(stat.networkTxBytes))}</div>
												</div>
											)}
											<div className="flex flex-wrap items-center gap-2">
												{c.State !=="running" && (
													<button onClick={() => handleAction(c,"start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--success-bg)] text-[var(--success)] rounded-lg hover:bg-[var(--success-bg)] transition disabled:opacity-50">{t("dockerPage.action.start")}</button>
												)}
												{c.State ==="running" && (
													<>
														<button onClick={() => handleAction(c,"stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg hover:bg-[var(--warning-bg)] transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
														<button onClick={() => handleAction(c,"restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-[var(--text-primary)] transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
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
									<div key={c.Id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
										<div className="mb-2 flex items-center justify-between gap-3">
											<div className="flex min-w-0 items-center gap-3">
												<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stateColors[c.State] ||"bg-[var(--surface-hover)]/50 text-[var(--text-muted)]"}`}>
													{stateLabel(t, c.State)}
												</span>
												<span className="truncate text-sm font-medium text-[var(--text-primary)]">{(c.Names?.[0] || c.Id?.slice(0, 12)).replace(/^\//,"")}</span>
											</div>
											<span className="ml-3 truncate text-[10px] text-[var(--text-muted)]">{c.Image}</span>
										</div>
										<div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
											<span>{c.Status}</span>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											{c.State !=="running" && <button onClick={() => handleAction(c,"start")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--success-bg)] text-[var(--success)] rounded-lg hover:bg-[var(--success-bg)] transition disabled:opacity-50">{t("dockerPage.action.start")}</button>}
											{c.State ==="running" && (
												<>
													<button onClick={() => handleAction(c,"stop")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg hover:bg-[var(--warning-bg)] transition disabled:opacity-50">{t("dockerPage.action.stop")}</button>
													<button onClick={() => handleAction(c,"restart")} disabled={actionLoading === c.Id} className="min-h-11 px-2.5 py-1 text-[10px] bg-[var(--accent-bg)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] hover:text-[var(--text-primary)] transition disabled:opacity-50">{t("dockerPage.action.restart")}</button>
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
				<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeRemovalDialog}>
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
							 data-action-button data-variant="secondary" className="min-h-11 !px-3 !py-1.5 !text-xs">
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

			<ConfirmDialog
				open={pendingProjectDown !== null}
				title={t("dockerPage.project.downTitle")}
				description={t("dockerPage.project.downConfirm").replace("{project}",
					pendingProjectDown ?? "",
				)}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("dockerPage.project.downConfirmBtn")}
				onCancel={() => setPendingProjectDown(null)}
				onConfirm={() => void confirmProjectDown()}
				busy={pendingProjectDown !== null && projectActionLoading === `${pendingProjectDown}:down`}
			/>

			{logsId && (
				<div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={closeLogsDialog}>
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
								className="min-h-11 min-w-11 rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-disabled)] focus:outline-none focus:ring-[var(--color-action-ring)]"
							>
								<svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
							</button>
						</div>
						<pre className="flex-1 overflow-auto text-[11px] text-[var(--text-secondary)] bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] rounded-lg p-3 font-mono whitespace-pre-wrap">{logs}</pre>
					</div>
				</div>
			)}
		</PageShell>
	);
}
