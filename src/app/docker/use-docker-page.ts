"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
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
import { describeFailure, getErrorMessage } from "@/lib/http/error-message";

export type ContainerAction = "start" | "stop" | "restart" | "remove";
export type ProjectAction = "up" | "down" | "start" | "stop" | "restart" | "ps";

export function useDockerPage(
	initialServers: { id: string; name: string; host: string }[],
	/**
	 * Whether the viewer may act on the hub host's own Docker daemon. The API
	 * answers 403 for everyone else (see `assertHubHostDockerAccess`), so a
	 * tenant-level operator starts on their first server instead of on a scope
	 * they cannot read.
	 */
	canManageHubHost = true,
) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const [containers, setContainers] = useState<Container[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	// The container list could not be loaded (no target, an error, Docker unreachable): the list then says so
	// instead of "no containers", which contradicted the error above it.
	const [listFailed, setListFailed] = useState(false);
	const [logsId, setLogsId] = useState<string | null>(null);
	const [logs, setLogs] = useState("");
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [projectActionLoading, setProjectActionLoading] = useState<string | null>(null);
	const [dialogError, setDialogError] = useState("");
	const [logTail, setLogTail] = useState(50);
	const [stats, setStats] = useState<Record<string, ContainerStats>>({});
	const [statsAutoRefresh, setStatsAutoRefresh] = useState(false);
	const [pendingRemoval, setPendingRemoval] = useState<Container | null>(null);
	const [pendingProjectDown, setPendingProjectDown] = useState<string | null>(null);
	const refreshIntervalSeconds = useRefreshInterval(30);
	const [dockerScope, setDockerScope] = useState<DockerScope | null>(null);
	const [serverList] = useState<ServerOption[]>(initialServers);
	const { state: dockerUrl, patch: patchDockerUrl } = useUrlQueryState({ server: "", serverId: "" });
	const fallbackServerId = canManageHubHost ? "" : (initialServers[0]?.id ?? "");
	const selectedServerId = dockerUrl.server || dockerUrl.serverId || fallbackServerId;
	const invalidTarget = Boolean(selectedServerId && !serverList.some(s => s.id === selectedServerId));
	const selectedServerIdRef = useRef(selectedServerId);
	const setSelectedServerId = (value: string) => {
		selectedServerIdRef.current = value;
		setPendingRemoval(null);
		setPendingProjectDown(null);
		setDialogError("");
		setLogsId(null);
		patchDockerUrl({ server: value, serverId: "" });
	};
	const closeRemovalDialog = useCallback(() => setPendingRemoval(null), []);
	const closeLogsDialog = useCallback(() => setLogsId(null), []);
	const removeCancelButtonRef = useRef<HTMLButtonElement | null>(null);
	const logsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
	const fetchingStatsRef = useRef<Set<string>>(new Set());
	const statsServerIdRef = useRef(selectedServerId);
	const logsReqRef = useRef<{ id: string; serverId: string } | null>(null);
	const fetchGenRef = useRef(0);
	const fetchAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		statsServerIdRef.current = selectedServerId;
	}, [selectedServerId]);

	/* eslint-disable react-hooks/set-state-in-effect -- close open host-scoped dialogs whenever URL/host changes */
	useEffect(() => {
		selectedServerIdRef.current = selectedServerId;
		setPendingRemoval(null);
		setPendingProjectDown(null);
		setDialogError("");
		setLogsId(null);
		logsReqRef.current = null;
	}, [selectedServerId]);
	/* eslint-enable react-hooks/set-state-in-effect */

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
		// A tenant account with no manageable server fell back to the hub host,
		// got 403 and saw "cannot connect to Docker" (A6-14): say what is missing.
		if (invalidTarget || (!selectedServerId && !canManageHubHost)) {
			setContainers([]);
			setListFailed(true);
			setError(t(invalidTarget ? "dockerPage.invalidTarget" : "dockerPage.error.noTargets"));
			// Nothing is on its way: the list said "loading" under this notice for good.
			setLoading(false);
			return;
		}
		try {
			const url = selectedServerId
				? `/api/docker/containers?serverId=${encodeURIComponent(selectedServerId)}`
				: "/api/docker/containers";
			const data = await csrfFetch(url, { signal: controller.signal } as RequestInit);
			if (gen !== fetchGenRef.current) return;
			if (data.error) {
				setListFailed(true);
				setError(data.error);
				return;
			}
			setError("");
			if (data.dockerScope && typeof data.dockerScope === "object") {
				setDockerScope(data.dockerScope as DockerScope);
			}
			if (data.dockerAvailable === false) {
				setContainers([]);
				setListFailed(true);
				// The API's unavailable message is English-only server copy; the
				// localized "cannot connect" key covers exactly this state.
				setError(t("dockerPage.error.fetch"));
				return;
			}
			const nextContainers: Container[] | null = data.data && Array.isArray(data.data)
				? (data.data as Container[])
				: Array.isArray(data)
					? (data as Container[])
					: null;
			if (nextContainers) {
				setContainers(nextContainers);
				setListFailed(false);
			}
		} catch (err) {
			if (controller.signal.aborted || gen !== fetchGenRef.current) return;
			setListFailed(true);
			// The server says why (no access to this server, too many requests, the SSH failure); "cannot reach the
			// Docker API" is only for an answer that says nothing.
			setError(getErrorMessage(err, t("dockerPage.error.fetch")));
		} finally {
			if (gen === fetchGenRef.current) setLoading(false);
		}
	}, [t, selectedServerId, canManageHubHost, invalidTarget]);

	useEffect(() => () => {
		fetchAbortRef.current?.abort();
	}, []);

	const handleAction = async (container: Container, action: ContainerAction) => {
		const id = container.Id;
		const serverAtAction = selectedServerId;
		setActionLoading(id);
		setDialogError("");
		try {
			const data = await csrfFetch<Record<string, unknown>>("/api/docker/containers", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({ id, action, ...(serverAtAction ? { serverId: serverAtAction } : {}) }),
			});
			if (data?.ok === false) {
				const reason = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
				throw new Error(reason);
			}
			// Skip the post-action refresh when the user switched servers while
			// the POST was in flight: the stale closure would abort the new
			// selection's request and overwrite its list with the old server's
			// containers. The new selection's own effect has already refreshed.
			if (selectedServerIdRef.current !== serverAtAction) return;
			addToast("success", t("dockerPage.action.done", { action: t(`dockerPage.action.${action}`) }));
			if (action === "remove") setPendingRemoval(null);
			await fetchContainers();
		} catch (err) {
			if (selectedServerIdRef.current !== serverAtAction) return;
			const message = getErrorMessage(err, t("dockerPage.error.action"));
			if (action === "remove") setDialogError(message);
			else addToast("error", message);
		} finally {
			setActionLoading(null);
		}
	};

	const requestRemoval = (container: Container) => {
		setPendingRemoval(container);
		setDialogError("");
	};

	const confirmRemoval = async () => {
		if (!pendingRemoval) return;
		const container = pendingRemoval;
		await handleAction(container,"remove");
	};

	const handleProjectAction = async (
		project: string,
		action: ProjectAction,
	) => {
		if (action ==="down") {
			// Destructive: use in-app ConfirmDialog (not browser window.confirm).
			setPendingProjectDown(project);
			setDialogError("");
			return;
		}
		await runProjectAction(project, action);
	};

	const runProjectAction = async (
		project: string,
		action: ProjectAction,
	) => {
		const serverAtAction = selectedServerId;
		setProjectActionLoading(`${project}:${action}`);
		setDialogError("");
		try {
			const data = await csrfFetch("/api/docker/compose", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({
					project,
					action,
					...(serverAtAction ? { serverId: serverAtAction } : {}),
				}),
			});
			const modeLabel =
				data.mode ==="compose-cli"
					? t("dockerPage.project.modeCli")
					: t("dockerPage.project.modeFallback");
			const actionLabelKey = `dockerPage.project.${action}` as const;
			const actionLabel = t(actionLabelKey) !== actionLabelKey ? t(actionLabelKey) : action;
			if (selectedServerIdRef.current !== serverAtAction) return;
			if (data.ok === false) {
				const reason = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "";
				throw new Error(reason);
			}
			const msg = t("dockerPage.project.success", { project, message: actionLabel });
			addToast("success", `${msg} (${modeLabel})`);
			if (action === "down") setPendingProjectDown(null);
			// Same stale-closure guard as handleAction: never let an action that
			// started on server A refresh the list after the user moved to B.
			if (action !== "ps" && selectedServerIdRef.current === serverAtAction) {
				await fetchContainers();
			}
		} catch (err) {
			if (selectedServerIdRef.current !== serverAtAction) return;
			const message = getErrorMessage(err, t("dockerPage.project.failed"));
			if (action === "down") setDialogError(message);
			else addToast("error", message);
		} finally {
			setProjectActionLoading(null);
		}
	};

	const confirmProjectDown = async () => {
		if (!pendingProjectDown) return;
		const project = pendingProjectDown;
		await runProjectAction(project,"down");
	};


	const fetchLogs = async (id: string, tail = logTail) => {
		setLogTail(tail);
		setLogsId(id);
		setLogs("");
		const serverAtFetch = selectedServerId;
		const request = { id, serverId: serverAtFetch };
		logsReqRef.current = request;
		try {
			const params = new URLSearchParams({ logs: id, tail: String(tail) });
			if (serverAtFetch) params.set("serverId", serverAtFetch);
			const data = await csrfFetch(`/api/docker/containers?${params}`);
			// Drop stale responses after container switch or host change (mirrors fetchStats).
			const active = logsReqRef.current;
			if (active !== request || selectedServerIdRef.current !== serverAtFetch) return;
			setLogs(typeof data.data === "string" ? data.data : JSON.stringify(data.data, null, 2));
		} catch (err) {
			const active = logsReqRef.current;
			if (active !== request || selectedServerIdRef.current !== serverAtFetch) return;
			setLogs(describeFailure(t("dockerPage.error.logs"), err));
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
		} catch {
			// Stats are best-effort telemetry; a failed probe must not surface
			// as an unhandled rejection. The auto-refresh cycle retries when
			// enabled.
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
		const timer = window.setTimeout(() => {
			for (const container of runningContainers) {
				if (stats[container.Id]) continue;
				void fetchStats(container.Id);
			}
		}, 0);
		return () => window.clearTimeout(timer);
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
		listFailed,
		clearError: () => setError(""),
		logsId,
		logs,
		actionLoading,
		projectActionLoading,
		dialogError,
		logTail,
		stats,
		statsAutoRefresh,
		setStatsAutoRefresh,
		pendingRemoval,
		pendingProjectDown,
		setPendingProjectDown,
		refreshIntervalSeconds,
		dockerScope,
		invalidTarget,
		serverList,
		selectedServerId,
		setSelectedServerId,
		closeRemovalDialog,
		closeLogsDialog,
		removeCancelButtonRef,
		logsCloseButtonRef,
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
