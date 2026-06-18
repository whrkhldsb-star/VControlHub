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

type Settings = {
	mode: AiOpsMode;
	providerId: string | null;
	scanScheduleHour: number;
};

type Props = {
	initialSummary: AiOpsSummary;
	initialLogs: AiOpsLogRecord[];
	initialSettings: Settings;
	canManage: boolean;
	canAutonomous: boolean;
};

const cardClass =
	"rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5";
const labelClass =
	"text-xs font-medium text-slate-300 tracking-wide";
const selectClass =
	"rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/30";
const inputClass =
	"w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30";
const buttonPrimary =
	"rounded-lg bg-cyan-500/80 hover:bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed";
const buttonGhost =
	"rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] px-4 py-2 text-sm text-white/80 transition";
const buttonDanger =
	"rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 text-xs text-rose-200 transition";

function formatTime(iso: string | null, fallback: string): string {
	if (!iso) return fallback;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return fallback;
	return date.toLocaleString();
}

function isExecutedAction(
	action: AiOpsLogRecord["actions"][number],
): action is Extract<AiOpsLogRecord["actions"][number], { executed: boolean }> {
	return "executed" in action;
}

function isRecommendationAction(
	action: AiOpsLogRecord["actions"][number],
): action is Extract<AiOpsLogRecord["actions"][number], { requiresApproval: boolean }> {
	return "requiresApproval" in action;
}

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
	const [settings, setSettings] = useState<Settings>(initialSettings);
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
				csrfFetch(`/api/ai/ops/logs?${params.toString()}`),
				csrfFetch("/api/ai/ops/summary"),
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
			const res = await csrfFetch("/api/ai/ops/scan", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ notes: "manual-trigger-ui" }),
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
			const res = await csrfFetch("/api/ai/ops/settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					mode: settings.mode,
					providerId: editingProvider,
				}),
			});
			if (!res.ok) throw new Error(`status=${res.status}`);
			const body = (await res.json()) as Settings;
			setSettings(body);
			setEditingProvider(body.providerId ?? "");
			addToast("success", t("aiOpsPage.settings.title"));
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
				const res = await csrfFetch(
					`/api/ai/ops/logs/${encodeURIComponent(logId)}/execute`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ actionId, forceAutonomous }),
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

	const selectedLog = useMemo(
		() => logs.find((l) => l.id === selectedLogId) ?? null,
		[logs, selectedLogId],
	);

	return (
		<div className="space-y-6">
			<section aria-label="ai-ops-summary" className={cardClass}>
				<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.summary.title")}</h2>
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
					<div>
						<div className={`${labelClass} opacity-60`}>
							{t("aiOpsPage.summary.total")}
						</div>
						<div className="mt-1 text-2xl font-semibold text-white">
							{summary.total}
						</div>
					</div>
					<div>
						<div className={`${labelClass} opacity-60`}>
							{t("aiOpsPage.summary.byStatus")}
						</div>
						<div className="mt-1 text-sm text-white/80">
							{Object.entries(summary.byStatus)
								.map(([k, v]) => `${k}=${v}`)
								.join(" · ") || "—"}
						</div>
					</div>
					<div>
						<div className={`${labelClass} opacity-60`}>
							{t("aiOpsPage.summary.byMode")}
						</div>
						<div className="mt-1 text-sm text-white/80">
							{Object.entries(summary.byMode)
								.map(([k, v]) => `${k}=${v}`)
								.join(" · ") || "—"}
						</div>
					</div>
					<div>
						<div className={`${labelClass} opacity-60`}>
							{t("aiOpsPage.summary.lastScanAt")}
						</div>
						<div className="mt-1 text-sm text-white/80">
							{formatTime(summary.lastScanAt, t("aiOpsPage.summary.never"))}
						</div>
					</div>
					<div>
						<div className={`${labelClass} opacity-60`}>
							{t("aiOpsPage.summary.lastErrorAt")}
						</div>
						<div className="mt-1 text-sm text-white/80">
							{formatTime(summary.lastErrorAt, t("aiOpsPage.summary.never"))}
						</div>
					</div>
				</div>
			</section>

			<section aria-label="ai-ops-actions" className={`${cardClass} flex flex-wrap items-center gap-3`}>
				{canManage && (
					<button
						type="button"
						className={buttonPrimary}
						disabled={scanning}
						onClick={() => void triggerScan()}
					>
						{scanning
							? t("aiOpsPage.actions.scanning")
							: t("aiOpsPage.actions.triggerScan")}
					</button>
				)}
				<button
					type="button"
					className={buttonGhost}
					onClick={() => void reload()}
				>
					{t("aiOpsPage.actions.refresh")}
				</button>
				<label className={`${labelClass} flex items-center gap-2`}>
					<span>{t("aiOpsPage.filter.mode")}</span>
					<select
						className={selectClass}
						value={modeFilter}
						onChange={(e) =>
							setModeFilter(e.target.value as "all" | AiOpsMode)
						}
					>
						<option value="all">{t("aiOpsPage.filter.all")}</option>
						<option value="recommendation">{t("aiOpsPage.mode.recommendation")}</option>
						<option value="autonomous">{t("aiOpsPage.mode.autonomous")}</option>
					</select>
				</label>
				<label className={`${labelClass} flex items-center gap-2`}>
					<span>{t("aiOpsPage.filter.status")}</span>
					<select
						className={selectClass}
						value={statusFilter}
						onChange={(e) =>
							setStatusFilter(e.target.value as "all" | AiOpsStatus)
						}
					>
						<option value="all">{t("aiOpsPage.filter.all")}</option>
						<option value="ok">{t("aiOpsPage.status.ok")}</option>
						<option value="warning">{t("aiOpsPage.status.warning")}</option>
						<option value="error">{t("aiOpsPage.status.error")}</option>
						<option value="skipped">{t("aiOpsPage.status.skipped")}</option>
						<option value="running">{t("aiOpsPage.status.running")}</option>
					</select>
				</label>
				<label className={`${labelClass} flex items-center gap-2`}>
					<span>{t("aiOpsPage.filter.triggerType")}</span>
					<select
						className={selectClass}
						value={triggerFilter}
						onChange={(e) =>
							setTriggerFilter(e.target.value as "all" | AiOpsTriggerType)
						}
					>
						<option value="all">{t("aiOpsPage.filter.all")}</option>
						<option value="scheduled">{t("aiOpsPage.trigger.scheduled")}</option>
						<option value="manual">{t("aiOpsPage.trigger.manual")}</option>
						<option value="recommendation_followup">
							{t("aiOpsPage.trigger.recommendation_followup")}
						</option>
					</select>
				</label>
			</section>

			<section aria-label="ai-ops-settings" className={cardClass}>
				<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.settings.title")}</h2>
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="flex flex-col gap-2">
						<span className={labelClass}>{t("aiOpsPage.settings.mode")}</span>
						{canManage ? (
							<select
								className={selectClass}
								value={settings.mode}
								onChange={(e) =>
									setSettings((s) => ({ ...s, mode: e.target.value as AiOpsMode }))
								}
							>
								<option value="recommendation">{t("aiOpsPage.mode.recommendation")}</option>
								<option value="autonomous">{t("aiOpsPage.mode.autonomous")}</option>
							</select>
						) : (
							<span className="text-sm text-white/80">
								{settings.mode === "autonomous"
									? t("aiOpsPage.mode.autonomous")
									: t("aiOpsPage.mode.recommendation")}
							</span>
						)}
					</label>
					<label className="flex flex-col gap-2">
						<span className={labelClass}>{t("aiOpsPage.settings.provider")}</span>
						{canManage ? (
							<input
								type="text"
								className={inputClass}
								value={editingProvider}
								placeholder={t("aiOpsPage.settings.notConfigured")}
								onChange={(e) => setEditingProvider(e.target.value)}
							/>
						) : (
							<span className="text-sm text-white/80">
								{editingProvider.trim() || t("aiOpsPage.settings.notConfigured")}
							</span>
						)}
					</label>
				</div>
				{canManage && (
					<div className="mt-4 flex justify-end">
						<button
							type="button"
							className={buttonPrimary}
							disabled={savingSettings}
							onClick={() => void saveSettings()}
						>
							{savingSettings
								? t("aiOpsPage.actions.scanning")
								: t("aiOpsPage.actions.execute")}
						</button>
					</div>
				)}
			</section>

			<section aria-label="ai-ops-logs" className={cardClass}>
				<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.table.actions")}</h2>
				{logs.length === 0 ? (
					<div className="text-sm text-white/60">
						{t("aiOpsPage.actions.empty")}
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm text-white/80">
							<thead className="text-xs uppercase tracking-wide text-white/40">
								<tr>
									<th className="py-2">{t("aiOpsPage.table.time")}</th>
									<th className="py-2">{t("aiOpsPage.table.mode")}</th>
									<th className="py-2">{t("aiOpsPage.table.trigger")}</th>
									<th className="py-2">{t("aiOpsPage.table.status")}</th>
									<th className="py-2">{t("aiOpsPage.table.findings")}</th>
									<th className="py-2">{t("aiOpsPage.table.actions")}</th>
									<th className="py-2">{t("aiOpsPage.table.duration")}</th>
									<th className="py-2">{t("aiOpsPage.table.viewDetail")}</th>
								</tr>
							</thead>
							<tbody>
								{logs.map((log) => (
									<tr
										key={log.id}
										className={
											selectedLogId === log.id
												? "bg-cyan-500/10"
												: "hover:bg-white/[0.03]"
										}
									>
										<td className="py-2 pr-3 font-mono text-xs text-white/70">
											{formatTime(log.createdAt, "—")}
										</td>
										<td className="py-2 pr-3">
											{log.mode === "autonomous"
												? t("aiOpsPage.mode.autonomous")
												: t("aiOpsPage.mode.recommendation")}
										</td>
										<td className="py-2 pr-3">
											{log.triggerType === "scheduled"
												? t("aiOpsPage.trigger.scheduled")
												: log.triggerType === "manual"
													? t("aiOpsPage.trigger.manual")
													: t("aiOpsPage.trigger.recommendation_followup")}
										</td>
										<td className="py-2 pr-3">
											{t(`aiOpsPage.status.${log.status}`)}
										</td>
										<td className="py-2 pr-3">{log.findings.length}</td>
										<td className="py-2 pr-3">{log.actions.length}</td>
										<td className="py-2 pr-3 font-mono text-xs">
											{log.durationMs !== null
												? t("aiOpsPage.detail.durationMs").replace(
														"{ms}",
														String(log.durationMs),
													)
												: "—"}
										</td>
										<td className="py-2">
											<button
												type="button"
												className={buttonGhost}
												onClick={() => setSelectedLogId(log.id)}
											>
												{t("aiOpsPage.table.viewDetail")}
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{selectedLog && (
				<section aria-label="ai-ops-detail" className={cardClass}>
					<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.detail.title")}</h2>
					<div className="grid gap-4 lg:grid-cols-2">
						<div>
							<h3 className={`${labelClass} mb-2`}>
								{t("aiOpsPage.detail.findings")}
							</h3>
							{selectedLog.findings.length === 0 ? (
								<div className="text-sm text-white/60">
									{t("aiOpsPage.detail.findingsEmpty")}
								</div>
							) : (
								<ul className="space-y-2 text-sm text-white/80">
									{selectedLog.findings.map((f) => (
										<li
											key={f.id}
											className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
										>
											<div className="font-medium text-white">{f.title}</div>
											<div className="text-xs text-white/50">
												{t(`aiOpsPage.severity.${f.severity}`)}
											</div>
											<div className="mt-1 text-xs text-white/70">{f.body}</div>
										</li>
									))}
								</ul>
							)}
						</div>
						<div>
							<h3 className={`${labelClass} mb-2`}>
								{t("aiOpsPage.detail.recommendedActions")}
							</h3>
							{selectedLog.actions.length === 0 ? (
								<div className="text-sm text-white/60">
									{t("aiOpsPage.detail.recommendedActionsEmpty")}
								</div>
							) : (
								<ul className="space-y-2 text-sm text-white/80">
									{selectedLog.actions.map((action) => {
										const recommendation = isRecommendationAction(action)
											? action
											: null;
										const executed = isExecutedAction(action) ? action : null;
										return (
											<li
												key={action.id}
												className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
											>
												<div>
													<div className="font-medium text-white">
														{action.action}
													</div>
													<div className="text-xs text-white/50">
														{t(`aiOpsPage.risk.${action.risk}`)}
													</div>
													{recommendation?.reason && (
														<div className="mt-1 text-xs text-white/70">
															{recommendation.reason}
														</div>
													)}
													{executed && (
														<div className="mt-1 text-xs text-white/70">
															{executed.result ?? executed.errorMessage ?? "—"}
														</div>
													)}
												</div>
												{recommendation && canManage && (
													<div className="flex flex-col gap-1">
														{recommendation.requiresApproval ? (
															<button
																type="button"
																className={buttonPrimary}
																disabled={executing === action.id}
																onClick={() =>
																	void executeAction(
																		selectedLog.id,
																		action.id,
																		false,
																	)
																}
															>
																{t("aiOpsPage.actions.approve")}
															</button>
														) : (
															<button
																type="button"
																className={buttonGhost}
																disabled={executing === action.id}
																onClick={() =>
																	void executeAction(
																		selectedLog.id,
																		action.id,
																		false,
																	)
																}
															>
																{t("aiOpsPage.actions.execute")}
															</button>
														)}
														{canAutonomous && (
															<button
																type="button"
																className={buttonDanger}
																disabled={executing === action.id}
																onClick={() =>
																	void executeAction(
																		selectedLog.id,
																		action.id,
																		true,
																	)
																}
															>
																{t("aiOpsPage.actions.forceAutonomous")}
															</button>
														)}
													</div>
												)}
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>
					{selectedLog.errorMessage && (
						<div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
							<div className="text-xs uppercase tracking-wide text-rose-200">
								{t("aiOpsPage.detail.errorMessage")}
							</div>
							<div className="mt-1">{selectedLog.errorMessage}</div>
						</div>
					)}
				</section>
			)}
		</div>
	);
}
