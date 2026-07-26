"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { useI18n } from "@/lib/i18n/use-locale";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import {
	type Container,
	type ContainerStats,
	type DockerScope,
	type ServerOption,
} from "./docker-helpers";
import { getErrorMessage } from "@/lib/http/error-message";

export type ContainerAction = "start" | "stop" | "restart" | "remove";
export type ProjectAction = "up" | "down" | "start" | "stop" | "restart" | "ps";

export function useDockerPage(initialServers: { id: string; name: string; host: string }[]) {
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
	const [dockerScope, setDockerScope] = useState<DockerScope | null>(null);
	const [serverList] = useState<ServerOption[]>(initialServers);
	const { state: dockerUrl, setField: setDockerUrlField } = useUrlQueryState({ serverId: "" });
	const selectedServerId = dockerUrl.serverId || "";
	const setSelectedServerId = (value: string) => setDockerUrlField("serverId", value);
	const closeRemovalDialog = useCallback(() => setPendingRemoval(null), []);
	const closeLogsDialog = useCallback(() => setLogsId(null), []);
	const removeCancelButtonRef = useRef<HTMLButtonElement | null>(null);
	const logsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
	const removalDialogRef = useDialogFocus<HTMLDivElement>({ open: pendingRemoval !== null, onClose: closeRemovalDialog, initialFocusRef: removeCancelButtonRef });
	const logsDialogRef = useDialogFocus<HTMLDivElement>({ open: logsId !== null, onClose: closeLogsDialog, initialFocusRef: logsCloseButtonRef });
	const fetchingStatsRef = useRef<Set<string>>(new Set());
	const statsServerIdRef = useRef(selectedServerId);
	const logsReqRef = useRef<{ id: string; serverId: string } | null>(null);
	const fetchGenRef = useRef(0);
	const fetchAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		statsServerIdRef.current = selectedServerId;
	}, [selectedServerId]);

	const { grouped, ungrouped } = useMemo(() => {
		const groups = new Map<string, Container[]>();
		const loose: Container[] = [];
		for (const container of containers) {
			const project = container.Labels?.["com.docker.compose.project"];
			if (project) {
				const list = groups.get(project) ?? [];
				list.push(container);
				groups.set(project, list);
			} else {
				loose.push(container);
			}
		}
		return {
			grouped: Array.from(groups.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([project, groupContainers]) => ({ project, containers: groupContainers })),
			ungrouped: loose,
		};
	}, [containers]);

	const fetchContainers = useCallback(async () => {
		fetchAbortRef.current?.abort();
		const controller = new AbortController();
		fetchAbortRef.current = controller;
		const gen = ++fetchGenRef.current;
		try {
			const url = selectedServerId
				? `/api/docker/containers?serverId=${encodeURIComponent(selectedServerId)}`
				: "/api/docker/containers";
			const data = await csrfFetch(url, { signal: controller.signal } as RequestInit);
			if (gen !== fetchGenRef.current) return;
			if (data.error) {
				setError(data.error);
				return;
			}
			setError("");
			if (data.dockerScope && typeof data.dockerScope === "object") {
				setDockerScope(data.dockerScope as DockerScope);
			}
			const nextContainers: Container[] | null = data.data && Array.isArray(data.data)
				? (data.data as Container[])
				: Array.isArray(data)
					? (data as Container[])
					: null;
			if (nextContainers) {
				setContainers(nextContainers);
			}
		} catch (_err) {
			if (controller.signal.aborted || gen !== fetchGenRef.current) return;
			setError(t("dockerPage.error.fetch"));
		} finally {
			if (gen === fetchGenRef.current) setLoading(false);
		}
	}, [t, selectedServerId]);

	useEffect(() => () => {
		fetchAbortRef.current?.abort();
	}, []);

	const handleAction = async (container: Container, action: ContainerAction) => {
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
			setError(getErrorMessage(err, t("dockerPage.error.action")));
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
		action: ProjectAction,
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
		action: ProjectAction,
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
			const msg = typeof data.message ==="string" ? data.message : t("dockerPage.project.success", { project, message: actionLabel });
			setProjectMessage(`${msg} (${modeLabel})`);
			if (action !=="ps") {
				await fetchContainers();
			}
		} catch (err) {
			setError(getErrorMessage(err, t("dockerPage.project.failed")));
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
		setLogs("");
		const serverAtFetch = selectedServerId;
		logsReqRef.current = { id, serverId: serverAtFetch };
		try {
			const params = new URLSearchParams({ logs: id, tail: "50" });
			if (serverAtFetch) params.set("serverId", serverAtFetch);
			const data = await csrfFetch(`/api/docker/containers?${params}`);
			// Drop stale responses after container switch or host change (mirrors fetchStats).
			const active = logsReqRef.current;
			if (!active || active.id !== id || active.serverId !== serverAtFetch) return;
			setLogs(typeof data.data === "string" ? data.data : JSON.stringify(data.data, null, 2));
		} catch {
			const active = logsReqRef.current;
			if (!active || active.id !== id || active.serverId !== serverAtFetch) return;
			setLogs(t("dockerPage.error.logs"));
		}
	};

	const fetchStats = async (id: string) => {
		if (fetchingStatsRef.current.has(id)) return;
		fetchingStatsRef.current.add(id);
		const serverAtFetch = selectedServerId;
		try {
			const statsParams = new URLSearchParams({ stats: id });
			if (serverAtFetch) statsParams.set("serverId", serverAtFetch);
			const data = await csrfFetch(`/api/docker/containers?${statsParams}`);
			// Drop stale results after server switch.
			if (statsServerIdRef.current !== serverAtFetch) return;
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

	return {
		containers,
		loading,
		setLoading,
		error,
		logsId,
		logs,
		actionLoading,
		projectActionLoading,
		projectMessage,
		stats,
		statsAutoRefresh,
		setStatsAutoRefresh,
		pendingRemoval,
		pendingProjectDown,
		setPendingProjectDown,
		refreshIntervalSeconds,
		dockerScope,
		serverList,
		selectedServerId,
		setSelectedServerId,
		closeRemovalDialog,
		closeLogsDialog,
		removeCancelButtonRef,
		logsCloseButtonRef,
		removalDialogRef,
		logsDialogRef,
		grouped,
		ungrouped,
		fetchContainers,
		handleAction,
		requestRemoval,
		confirmRemoval,
		handleProjectAction,
		confirmProjectDown,
		fetchLogs,
		fetchStats,
		runningContainers,
		projectCount,
	};
}
