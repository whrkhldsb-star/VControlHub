/**
 * TR-032 E02: /ai-ops 页面 client component.
 *
 * Renders the AI ops UI shell:
 *   - Summary cards (total / byStatus / byMode / last scan / last error)
 *   - Logs table with filters (mode / status / triggerType)
 *   - Detail panel (findings + recommended actions + executed actions)
 *   - Settings editor (mode select + providerId text input + scan button)
 *
 * Mirrors the cost-summary page pattern: the server pre-loads summary +
 * logs + settings, and the client re-fetches on filter / scan / execute /
 * settings change via the existing /api/ai/ops/* routes.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { describeFailure } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import type {
	AiOpsLogRecord,
	AiOpsMode,
	AiOpsStatus,
	AiOpsTriggerType,
} from "@/lib/ai/ops/types";
import type { AiOpsSummary } from "@/lib/ai/ops/service";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/page-shell";
import {
	AiOpsDetailSection,
	AiOpsHeaderActions,
	AiOpsLogsSection,
	AiOpsSettingsSection,
	AiOpsSummarySection,
	type AiOpsSettings,
	type AiOpsStoredProvider,
} from "./ai-ops-sections";

/** How often, and for how long, the list is read again after a scan was queued. */
const SCAN_RESULT_POLL_MS = 5_000;
const SCAN_RESULT_WATCH_MS = 3 * 60_000;

type Props = {
	/** Page header; rendered here so the page's commands sit in its actions. */
	header?: { eyebrow?: string; title: string; description?: string };
	initialSummary: AiOpsSummary;
	initialLogs: AiOpsLogRecord[];
	initialTotal: number;
	initialHasMore: boolean;
	initialSettings: AiOpsSettings;
	providerOptions?: Array<{ id: string; name: string; defaultModel: string }>;
	/** What the saved provider setting points at; it may belong to another administrator, or be gone. */
	storedProvider?: AiOpsStoredProvider | null;
	canManage: boolean;
	canAutonomous: boolean;
};

export function AiOpsPageClient({
	header,
	initialSummary,
	initialLogs,
	initialTotal,
	initialHasMore,
	initialSettings,
	providerOptions = [],
	storedProvider = null,
	canManage,
	canAutonomous,
}: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();

	const [logs, setLogs] = useState<AiOpsLogRecord[]>(initialLogs);
	const [logsPage, setLogsPage] = useState(0);
	const [totalLogs, setTotalLogs] = useState(initialTotal);
	const [hasMoreLogs, setHasMoreLogs] = useState(initialHasMore);
	const [loadingLogs, setLoadingLogs] = useState(false);
	const [summary, setSummary] = useState<AiOpsSummary>(initialSummary);
	const [settings, setSettings] = useState<AiOpsSettings>(initialSettings);
	const [modeFilter, setModeFilter] = useState<"all" | AiOpsMode>("all");
	const [statusFilter, setStatusFilter] = useState<"all" | AiOpsStatus>("all");
	const [triggerFilter, setTriggerFilter] = useState<"all" | AiOpsTriggerType>(
		"all",
	);
	const [scanning, setScanning] = useState(false);
	const [savingSettings, setSavingSettings] = useState(false);
	const [editingProvider, setEditingProvider] = useState(
		initialSettings.providerId ?? "",
	);
	const [selectedLogId, setSelectedLogId] = useState<string | null>(
		initialLogs[0]?.id ?? null,
	);
	const [executing, setExecuting] = useState<string | null>(null);
	// Only the latest load may write the list: an earlier filter's answer
	// arriving late replaced the list under the newer filter.
	const latestLoad = useRef(0);
	const loadLogsPage = useCallback(async (targetPage: number): Promise<AiOpsLogRecord[] | null> => {
		const load = ++latestLoad.current;
		setLoadingLogs(true);
		try {
			const params = new URLSearchParams();
			if (modeFilter !== "all") params.set("mode", modeFilter);
			if (statusFilter !== "all") params.set("status", statusFilter);
			if (triggerFilter !== "all") params.set("triggerType", triggerFilter);
			params.set("limit", "20");
			params.set("offset", String(targetPage * 20));
			const [logsBody, summaryBody] = await Promise.all([
				csrfFetch<{ logs: AiOpsLogRecord[]; total: number; hasMore: boolean }>(`/api/ai/ops/logs?${params.toString()}`),
				csrfFetch<{ summary: AiOpsSummary }>("/api/ai/ops/summary"),
			]);
			if (load !== latestLoad.current) return null;
			setLogs(logsBody.logs);
			setLogsPage(targetPage);
			setTotalLogs(logsBody.total);
			setHasMoreLogs(logsBody.hasMore);
			setSummary(summaryBody.summary);
			setSelectedLogId((prev) =>
				prev && logsBody.logs.some((l) => l.id === prev)
					? prev
					: (logsBody.logs[0]?.id ?? null),
			);
			return logsBody.logs;
		} catch (error) {
			if (load !== latestLoad.current) return null;
			addToast("error", describeFailure(t("aiOpsPage.actions.loadFailed"), error));
			return null;
		} finally {
			if (load === latestLoad.current) setLoadingLogs(false);
		}
	}, [modeFilter, statusFilter, triggerFilter, addToast, t]);

	const reload = useCallback(
		async () => loadLogsPage(logsPage),
		[loadLogsPage, logsPage],
	);

	// Refetch when filters change. Skip the initial mount so the
	// server-provided initial data stays as-is (avoids a redundant round
	// trip on first paint and the React 19 set-state-in-effect warning).
	const isFirstRender = useRef(true);
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		void loadLogsPage(0);
	}, [loadLogsPage]);

	// A queued scan is picked up by the worker within seconds and, with a provider's analysis, takes up to a
	// couple of minutes. One reload after 15 seconds usually came before its log existed: the list is read
	// again until a log newer than the one before the request has finished.
	const scanWatch = useRef<number | null>(null);
	// The list as it is filtered and paged now, not as it was when the scan was requested.
	const reloadNow = useRef(reload);
	useEffect(() => {
		reloadNow.current = reload;
	}, [reload]);
	useEffect(() => () => {
		if (scanWatch.current !== null) window.clearTimeout(scanWatch.current);
	}, []);
	const watchForScanResult = useCallback((newestBefore: string | null) => {
		const startedAt = Date.now();
		if (scanWatch.current !== null) window.clearTimeout(scanWatch.current);
		const look = async () => {
			scanWatch.current = null;
			const newest = (await reloadNow.current())?.[0];
			const finished = Boolean(newest && newest.id !== newestBefore && newest.status !== "running");
			if (!finished && Date.now() - startedAt < SCAN_RESULT_WATCH_MS) {
				scanWatch.current = window.setTimeout(() => { void look(); }, SCAN_RESULT_POLL_MS);
			}
		};
		scanWatch.current = window.setTimeout(() => { void look(); }, SCAN_RESULT_POLL_MS);
	}, []);

	const triggerScan = useCallback(async () => {
		if (!canManage) return;
		setScanning(true);
		try {
			const body = await csrfFetch<{ triggered: boolean; queued?: boolean; latestLog: AiOpsLogRecord | null }>("/api/ai/ops/scan", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			// The scan is queued for the worker (A7-04); the log row appears once it has run.
			addToast(
				"success",
				body.triggered
					? t("aiOpsPage.actions.scanQueued")
					: t("aiOpsPage.actions.scanning"),
			);
			await reload();
			if (body.triggered) watchForScanResult(body.latestLog?.id ?? null);
		} catch (error) {
			addToast("error", describeFailure(t("aiOpsPage.actions.triggerFailed"), error));
		} finally {
			setScanning(false);
		}
	}, [canManage, addToast, t, reload, watchForScanResult]);

	const saveSettings = useCallback(async () => {
		if (!canManage) return;
		setSavingSettings(true);
		try {
			const body = await csrfFetch<AiOpsSettings>("/api/ai/ops/settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				// The provider goes along only when it was changed here: the saved one may be a colleague's.
				body: JSON.stringify({
					mode: settings.mode,
					...(editingProvider !== (settings.providerId ?? "") ? { providerId: editingProvider } : {}),
				}),
			});
			setSettings(body);
			setEditingProvider(body.providerId ?? "");
			addToast("success", t("aiOpsPage.settings.saved"));
		} catch (error) {
			addToast("error", describeFailure(t("aiOpsPage.settings.saveFailed"), error));
		} finally {
			setSavingSettings(false);
		}
	}, [canManage, settings, editingProvider, addToast, t]);

	const executeAction = useCallback(
		async (logId: string, actionId: string, forceAutonomous: boolean) => {
			if (!canManage) return;
			if (forceAutonomous && !canAutonomous) {
				addToast("error", t("aiOpsPage.actions.forceAutonomous"));
				return;
			}
			setExecuting(actionId);
			try {
				const body = await csrfFetch<{ result: { ok: boolean; executed: boolean; errorMessage?: string } }>(
					`/api/ai/ops/logs/${encodeURIComponent(logId)}/execute`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ actionId, forceAutonomous }),
					},
				);
				addToast(
					body.result.executed ? "success" : "info",
					body.result.executed
						? t("aiOpsPage.execute.executed")
						: (body.result.errorMessage ??
							t("aiOpsPage.execute.requiresApproval")),
				);
				await reload();
			} catch (error) {
				addToast("error", describeFailure(t("aiOpsPage.actions.executeFailed"), error));
			} finally {
				setExecuting(null);
			}
		},
		[canManage, canAutonomous, addToast, t, reload],
	);

	const approveAction = useCallback(
		async (logId: string, actionId: string) => {
			if (!canManage) return;
			setExecuting(actionId);
			try {
				const body = await csrfFetch<{ result: { ok: boolean; errorMessage?: string } }>(
					`/api/ai/ops/logs/${encodeURIComponent(logId)}/approve`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ actionId }),
					},
				);
				addToast(
					body.result.ok ? "success" : "error",
					body.result.ok
						? t("aiOpsPage.actions.approvedReady")
						: (body.result.errorMessage ?? t("aiOpsPage.actions.approvalFailed")),
				);
				await reload();
			} catch (error) {
				addToast("error", describeFailure(t("aiOpsPage.actions.approvalFailed"), error));
			} finally {
				setExecuting(null);
			}
		},
		[canManage, addToast, reload, t],
	);

	const selectedLog = useMemo(
		() => logs.find((l) => l.id === selectedLogId) ?? null,
		[logs, selectedLogId],
	);

	return (
		<div className="space-y-6">
			{header ? (
				<PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="">
					<AiOpsHeaderActions
						canManage={canManage}
						scanning={scanning}
						onTriggerScan={() => void triggerScan()}
						onReload={() => void reload()}
						t={t}
					/>
				</PageHeader>
			) : null}
			<AiOpsSummarySection summary={summary} t={t} />
			{/* What the scans found first; the settings that change how they run come last. */}
			<AiOpsLogsSection
				logs={logs}
				page={logsPage}
				total={totalLogs}
				hasMore={hasMoreLogs}
				loading={loadingLogs}
				filters={{ modeFilter, statusFilter, triggerFilter, setModeFilter, setStatusFilter, setTriggerFilter }}
				emptyAction={canManage ? (
					<ActionButton size="sm" variant="primary" disabled={scanning} onClick={() => void triggerScan()}>
						{scanning ? t("aiOpsPage.actions.scanning") : t("aiOpsPage.actions.triggerScan")}
					</ActionButton>
				) : undefined}
				selectedLogId={selectedLogId}
				setSelectedLogId={setSelectedLogId}
				onPrevious={() => void loadLogsPage(logsPage - 1)}
				onNext={() => void loadLogsPage(logsPage + 1)}
				t={t}
			/>
			{selectedLog && (
				<AiOpsDetailSection
					selectedLog={selectedLog}
					canManage={canManage}
					canAutonomous={canAutonomous}
					executing={executing}
					onApproveAction={(logId, actionId) => void approveAction(logId, actionId)}
					onExecuteAction={(logId, actionId, forceAutonomous) => void executeAction(logId, actionId, forceAutonomous)}
					t={t}
				/>
			)}
			<AiOpsSettingsSection
				settings={settings}
				providerOptions={providerOptions}
				storedProvider={storedProvider}
				editingProvider={editingProvider}
				canManage={canManage}
				savingSettings={savingSettings}
				setSettings={setSettings}
				setEditingProvider={setEditingProvider}
				onSaveSettings={() => void saveSettings()}
				t={t}
			/>
		</div>
	);
}
