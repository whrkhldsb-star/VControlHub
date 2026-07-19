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
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

import type {
	AiOpsLogRecord,
	AiOpsMode,
	AiOpsStatus,
	AiOpsTriggerType,
} from "@/lib/ai/ops/types";
import type { AiOpsSummary } from "@/lib/ai/ops/service";
import {
	AiOpsActionsToolbar,
	AiOpsDetailSection,
	AiOpsLogsSection,
	AiOpsSettingsSection,
	AiOpsSummarySection,
	type AiOpsSettings,
} from "./ai-ops-sections";

type Props = {
	initialSummary: AiOpsSummary;
	initialLogs: AiOpsLogRecord[];
	initialSettings: AiOpsSettings;
	canManage: boolean;
	canAutonomous: boolean;
};

export function AiOpsPageClient({
	initialSummary,
	initialLogs,
	initialSettings,
	canManage,
	canAutonomous,
}: Props) {
	const { t } = useI18n();
	const { addToast } = useToast();

	const [logs, setLogs] = useState<AiOpsLogRecord[]>(initialLogs);
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
	const reload = useCallback(async () => {
		try {
			const params = new URLSearchParams();
			if (modeFilter !== "all") params.set("mode", modeFilter);
			if (statusFilter !== "all") params.set("status", statusFilter);
			if (triggerFilter !== "all") params.set("triggerType", triggerFilter);
			params.set("limit", "50");
			const [logsRes, summaryRes] = await Promise.all([
				csrfFetch<Response>(`/api/ai/ops/logs?${params.toString()}`, {
					raw: true,
				}),
				csrfFetch<Response>("/api/ai/ops/summary", { raw: true }),
			]);
			if (!logsRes.ok || !summaryRes.ok) throw new Error("reload failed");
			const logsBody = (await logsRes.json()) as { logs: AiOpsLogRecord[] };
			const summaryBody = (await summaryRes.json()) as { summary: AiOpsSummary };
			setLogs(logsBody.logs);
			setSummary(summaryBody.summary);
			setSelectedLogId((prev) =>
				prev && logsBody.logs.some((l) => l.id === prev)
					? prev
					: (logsBody.logs[0]?.id ?? null),
			);
		} catch (error) {
			addToast(
				"error",
				`${t("aiOpsPage.actions.loadFailed")}: ${String(error)}`,
			);
		}
	}, [modeFilter, statusFilter, triggerFilter, addToast, t]);

	// Refetch when filters change. Skip the initial mount so the
	// server-provided initial data stays as-is (avoids a redundant round
	// trip on first paint and the React 19 set-state-in-effect warning).
	const isFirstRender = useRef(true);
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		void reload();
	}, [reload]);

	const triggerScan = useCallback(async () => {
		if (!canManage) return;
		setScanning(true);
		try {
			const res = await csrfFetch<Response>("/api/ai/ops/scan", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ notes: "manual-trigger-ui" }),
				raw: true,
			});
			if (!res.ok) throw new Error(`status=${res.status}`);
			const body = (await res.json()) as {
				triggered: boolean;
				latestLog: AiOpsLogRecord | null;
			};
			addToast(
				"success",
				body.triggered
					? t("aiOpsPage.actions.triggerScan")
					: t("aiOpsPage.actions.scanning"),
			);
			await reload();
		} catch (error) {
			addToast(
				"error",
				`${t("aiOpsPage.actions.triggerFailed")}: ${String(error)}`,
			);
		} finally {
			setScanning(false);
		}
	}, [canManage, addToast, t, reload]);

	const saveSettings = useCallback(async () => {
		if (!canManage) return;
		setSavingSettings(true);
		try {
			const res = await csrfFetch<Response>("/api/ai/ops/settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					mode: settings.mode,
					providerId: editingProvider,
				}),
				raw: true,
			});
			if (!res.ok) throw new Error(`status=${res.status}`);
			const body = (await res.json()) as AiOpsSettings;
			setSettings(body);
			setEditingProvider(body.providerId ?? "");
			addToast("success", t("aiOpsPage.settings.saved"));
		} catch (error) {
			addToast(
				"error",
				`${t("aiOpsPage.actions.executeFailed")}: ${String(error)}`,
			);
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
				const res = await csrfFetch<Response>(
					`/api/ai/ops/logs/${encodeURIComponent(logId)}/execute`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ actionId, forceAutonomous }),
						raw: true,
					},
				);
				if (!res.ok) throw new Error(`status=${res.status}`);
				const body = (await res.json()) as {
					result: {
						ok: boolean;
						executed: boolean;
						errorMessage?: string;
					};
				};
				addToast(
					body.result.executed ? "success" : "info",
					body.result.executed
						? t("aiOpsPage.execute.executed")
						: (body.result.errorMessage ??
							t("aiOpsPage.execute.requiresApproval")),
				);
				await reload();
			} catch (error) {
				addToast(
					"error",
					`${t("aiOpsPage.actions.executeFailed")}: ${String(error)}`,
				);
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
				const res = await csrfFetch<Response>(
					`/api/ai/ops/logs/${encodeURIComponent(logId)}/approve`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ actionId }),
						raw: true,
					},
				);
				if (!res.ok) throw new Error(`status=${res.status}`);
				const body = (await res.json()) as {
					result: { ok: boolean; errorMessage?: string };
				};
				addToast(
					body.result.ok ? "success" : "error",
					body.result.ok
						? t("aiOpsPage.actions.approvedReady")
						: (body.result.errorMessage ?? t("aiOpsPage.actions.approvalFailed")),
				);
				await reload();
			} catch (error) {
				addToast("error", `${t("aiOpsPage.actions.approvalFailed")}: ${String(error)}`);
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
			<AiOpsSummarySection summary={summary} t={t} />
			<AiOpsActionsToolbar
				canManage={canManage}
				scanning={scanning}
				modeFilter={modeFilter}
				statusFilter={statusFilter}
				triggerFilter={triggerFilter}
				onTriggerScan={() => void triggerScan()}
				onReload={() => void reload()}
				setModeFilter={setModeFilter}
				setStatusFilter={setStatusFilter}
				setTriggerFilter={setTriggerFilter}
				t={t}
			/>
			<AiOpsSettingsSection
				settings={settings}
				editingProvider={editingProvider}
				canManage={canManage}
				savingSettings={savingSettings}
				setSettings={setSettings}
				setEditingProvider={setEditingProvider}
				onSaveSettings={() => void saveSettings()}
				t={t}
			/>
			<AiOpsLogsSection logs={logs} selectedLogId={selectedLogId} setSelectedLogId={setSelectedLogId} t={t} />
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
		</div>
	);
}
