"use client";

import type { Dispatch, SetStateAction } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type {
	AiOpsLogRecord,
	AiOpsMode,
	AiOpsStatus,
	AiOpsTriggerType,
} from "@/lib/ai/ops/types";
import type { AiOpsSummary } from "@/lib/ai/ops/service";
import { UI_INPUT } from "@/lib/ui/classes";

export type AiOpsSettings = {
	mode: AiOpsMode;
	providerId: string | null;
	scanScheduleHour: number;
};

const cardClass =
	"rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5";
const labelClass =
	"text-xs font-medium text-[var(--text-secondary)] tracking-wide";
const selectClass = UI_INPUT;
const inputClass = UI_INPUT;
const buttonPrimary =
	"text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const buttonGhost =
	"text-sm";
const buttonDanger =
	"text-xs";

export function formatAiOpsTime(iso: string | null, fallback: string, locale: "zh" | "en"): string {
	if (!iso) return fallback;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return fallback;
	return date.toLocaleString(toDateLocale(locale));
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

type T = (key: string) => string;

export function AiOpsSummarySection({ summary, t }: { summary: AiOpsSummary; t: T }) {
	const { locale } = useI18n();
	return (
		<section aria-label="ai-ops-summary" className={cardClass}>
			<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.summary.title")}</h2>
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
				<div>
					<div className={`${labelClass} opacity-60`}>{t("aiOpsPage.summary.total")}</div>
					<div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{summary.total}</div>
				</div>
				<div>
					<div className={`${labelClass} opacity-60`}>{t("aiOpsPage.summary.byStatus")}</div>
					<div className="mt-1 text-sm text-[var(--text-primary)]">
						{Object.entries(summary.byStatus).map(([k, v]) => `${t(`aiOpsPage.status.${k}`)}=${v}`).join(" · ") || "—"}
					</div>
				</div>
				<div>
					<div className={`${labelClass} opacity-60`}>{t("aiOpsPage.summary.byMode")}</div>
					<div className="mt-1 text-sm text-[var(--text-primary)]">
						{Object.entries(summary.byMode).map(([k, v]) => `${t(`aiOpsPage.mode.${k}`)}=${v}`).join(" · ") || "—"}
					</div>
				</div>
				<div>
					<div className={`${labelClass} opacity-60`}>{t("aiOpsPage.summary.lastScanAt")}</div>
					<div className="mt-1 text-sm text-[var(--text-primary)]">{formatAiOpsTime(summary.lastScanAt, t("aiOpsPage.summary.never"), locale)}</div>
				</div>
				<div>
					<div className={`${labelClass} opacity-60`}>{t("aiOpsPage.summary.lastErrorAt")}</div>
					<div className="mt-1 text-sm text-[var(--text-primary)]">{formatAiOpsTime(summary.lastErrorAt, t("aiOpsPage.summary.never"), locale)}</div>
				</div>
			</div>
		</section>
	);
}

export function AiOpsActionsToolbar({
	canManage,
	scanning,
	modeFilter,
	statusFilter,
	triggerFilter,
	onTriggerScan,
	onReload,
	setModeFilter,
	setStatusFilter,
	setTriggerFilter,
	t,
}: {
	canManage: boolean;
	scanning: boolean;
	modeFilter: "all" | AiOpsMode;
	statusFilter: "all" | AiOpsStatus;
	triggerFilter: "all" | AiOpsTriggerType;
	onTriggerScan: () => void;
	onReload: () => void;
	setModeFilter: Dispatch<SetStateAction<"all" | AiOpsMode>>;
	setStatusFilter: Dispatch<SetStateAction<"all" | AiOpsStatus>>;
	setTriggerFilter: Dispatch<SetStateAction<"all" | AiOpsTriggerType>>;
	t: T;
}) {
	return (
		<section aria-label="ai-ops-actions" className={`${cardClass} flex flex-wrap items-center gap-3`}>
			{canManage && (
				<button type="button" data-action-button data-variant="primary" className={buttonPrimary} disabled={scanning} onClick={onTriggerScan}>
					{scanning ? t("aiOpsPage.actions.scanning") : t("aiOpsPage.actions.triggerScan")}
				</button>
			)}
			<button type="button" data-action-button data-variant="secondary" className={buttonGhost} onClick={onReload}>{t("aiOpsPage.actions.refresh")}</button>
			<label className={`${labelClass} flex items-center gap-2`}>
				<span>{t("aiOpsPage.filter.mode")}</span>
				<select className={selectClass} value={modeFilter} onChange={(e) => setModeFilter(e.target.value as "all" | AiOpsMode)}>
					<option value="all">{t("aiOpsPage.filter.all")}</option>
					<option value="recommendation">{t("aiOpsPage.mode.recommendation")}</option>
					<option value="autonomous">{t("aiOpsPage.mode.autonomous")}</option>
				</select>
			</label>
			<label className={`${labelClass} flex items-center gap-2`}>
				<span>{t("aiOpsPage.filter.status")}</span>
				<select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | AiOpsStatus)}>
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
				<select className={selectClass} value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value as "all" | AiOpsTriggerType)}>
					<option value="all">{t("aiOpsPage.filter.all")}</option>
					<option value="scheduled">{t("aiOpsPage.trigger.scheduled")}</option>
					<option value="manual">{t("aiOpsPage.trigger.manual")}</option>
					<option value="recommendation_followup">{t("aiOpsPage.trigger.recommendation_followup")}</option>
				</select>
			</label>
		</section>
	);
}

export function AiOpsSettingsSection({
	settings,
	editingProvider,
	canManage,
	savingSettings,
	setSettings,
	setEditingProvider,
	onSaveSettings,
	t,
}: {
	settings: AiOpsSettings;
	editingProvider: string;
	canManage: boolean;
	savingSettings: boolean;
	setSettings: Dispatch<SetStateAction<AiOpsSettings>>;
	setEditingProvider: Dispatch<SetStateAction<string>>;
	onSaveSettings: () => void;
	t: T;
}) {
	return (
		<section aria-label="ai-ops-settings" className={cardClass}>
			<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.settings.title")}</h2>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="flex flex-col gap-2">
					<span className={labelClass}>{t("aiOpsPage.settings.mode")}</span>
					{canManage ? (
						<select className={selectClass} value={settings.mode} onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value as AiOpsMode }))}>
							<option value="recommendation">{t("aiOpsPage.mode.recommendation")}</option>
							<option value="autonomous">{t("aiOpsPage.mode.autonomous")}</option>
						</select>
					) : (
						<span className="text-sm text-[var(--text-primary)]">{settings.mode === "autonomous" ? t("aiOpsPage.mode.autonomous") : t("aiOpsPage.mode.recommendation")}</span>
					)}
				</label>
				<label className="flex flex-col gap-2">
					<span className={labelClass}>{t("aiOpsPage.settings.provider")}</span>
					{canManage ? (
						<input type="text" className={inputClass} value={editingProvider} placeholder={t("aiOpsPage.settings.notConfigured")} onChange={(e) => setEditingProvider(e.target.value)} />
					) : (
						<span className="text-sm text-[var(--text-primary)]">{editingProvider.trim() || t("aiOpsPage.settings.notConfigured")}</span>
					)}
				</label>
			</div>
			{canManage && (
				<div className="mt-4 flex justify-end">
					<button type="button" data-action-button data-variant="primary" className={buttonPrimary} disabled={savingSettings} onClick={onSaveSettings}>
						{savingSettings ? t("aiOpsPage.actions.saving") : t("aiOpsPage.actions.execute")}
					</button>
				</div>
			)}
		</section>
	);
}

export function AiOpsLogsSection({ logs, selectedLogId, setSelectedLogId, t }: { logs: AiOpsLogRecord[]; selectedLogId: string | null; setSelectedLogId: Dispatch<SetStateAction<string | null>>; t: T }) {
	const { locale } = useI18n();
	return (
		<section aria-label="ai-ops-logs" className={cardClass}>
			<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.table.actions")}</h2>
			{logs.length === 0 ? (
				<div className="text-sm text-[var(--text-primary)]/70">{t("aiOpsPage.actions.empty")}</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm text-[var(--text-primary)]">
						<thead className="text-xs uppercase tracking-wide text-[var(--text-primary)]/70">
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
								<tr key={log.id} className={selectedLogId === log.id ? "bg-[var(--color-action)]/10" : "hover:bg-[var(--surface-elevated)]"}>
									<td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]/70">{formatAiOpsTime(log.createdAt, "—", locale)}</td>
									<td className="py-2 pr-3">{log.mode === "autonomous" ? t("aiOpsPage.mode.autonomous") : t("aiOpsPage.mode.recommendation")}</td>
									<td className="py-2 pr-3">{log.triggerType === "scheduled" ? t("aiOpsPage.trigger.scheduled") : log.triggerType === "manual" ? t("aiOpsPage.trigger.manual") : t("aiOpsPage.trigger.recommendation_followup")}</td>
									<td className="py-2 pr-3">{t(`aiOpsPage.status.${log.status}`)}</td>
									<td className="py-2 pr-3">{log.findings.length}</td>
									<td className="py-2 pr-3">{log.actions.length}</td>
									<td className="py-2 pr-3 font-mono text-xs">{log.durationMs !== null ? t("aiOpsPage.detail.durationMs").replace("{ms}", String(log.durationMs)) : "—"}</td>
									<td className="py-2"><button type="button" data-action-button data-variant="secondary" className={buttonGhost} onClick={() => setSelectedLogId(log.id)}>{t("aiOpsPage.table.viewDetail")}</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

export function AiOpsDetailSection({
	selectedLog,
	canManage,
	canAutonomous,
	executing,
	onApproveAction,
	onExecuteAction,
	t,
}: {
	selectedLog: AiOpsLogRecord;
	canManage: boolean;
	canAutonomous: boolean;
	executing: string | null;
	onApproveAction: (logId: string, actionId: string) => void;
	onExecuteAction: (logId: string, actionId: string, forceAutonomous: boolean) => void;
	t: T;
}) {
	return (
		<section aria-label="ai-ops-detail" className={cardClass}>
			<h2 className={`${labelClass} mb-4`}>{t("aiOpsPage.detail.title")}</h2>
			<div className="grid gap-4 lg:grid-cols-2">
				<div>
					<h3 className={`${labelClass} mb-2`}>{t("aiOpsPage.detail.findings")}</h3>
					{selectedLog.findings.length === 0 ? (
						<div className="text-sm text-[var(--text-primary)]/70">{t("aiOpsPage.detail.findingsEmpty")}</div>
					) : (
						<ul className="space-y-2 text-sm text-[var(--text-primary)]">
							{selectedLog.findings.map((f) => (
								<li key={f.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
									<div className="font-medium text-[var(--text-primary)]">{f.title}</div>
									<div className="text-xs text-[var(--text-primary)]/70">{t(`aiOpsPage.severity.${f.severity}`)}</div>
									<div className="mt-1 text-xs text-[var(--text-primary)]/70">{f.body}</div>
								</li>
							))}
						</ul>
					)}
				</div>
				<div>
					<h3 className={`${labelClass} mb-2`}>{t("aiOpsPage.detail.recommendedActions")}</h3>
					{selectedLog.actions.length === 0 ? (
						<div className="text-sm text-[var(--text-primary)]/70">{t("aiOpsPage.detail.recommendedActionsEmpty")}</div>
					) : (
						<ul className="space-y-2 text-sm text-[var(--text-primary)]">
							{selectedLog.actions.map((action) => {
								const recommendation = isRecommendationAction(action) ? action : null;
								const executed = isExecutedAction(action) ? action : null;
								return (
									<li key={action.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
										<div>
											<div className="font-medium text-[var(--text-primary)]">{action.action}</div>
											<div className="text-xs text-[var(--text-primary)]/70">{t(`aiOpsPage.risk.${action.risk}`)}</div>
											{recommendation?.reason && <div className="mt-1 text-xs text-[var(--text-primary)]/70">{recommendation.reason}</div>}
											{executed && <div className="mt-1 text-xs text-[var(--text-primary)]/70">{executed.result ?? executed.errorMessage ?? "—"}</div>}
										</div>
										{recommendation && canManage && (
											<div className="flex flex-col gap-1">
												{recommendation.requiresApproval && !recommendation.approved ? (
													<button type="button" data-action-button data-variant="primary" className={buttonPrimary} disabled={executing === action.id} onClick={() => onApproveAction(selectedLog.id, action.id)}>{t("aiOpsPage.actions.approve")}</button>
												) : recommendation.requiresApproval && recommendation.approved ? (
													<button type="button" data-action-button data-variant="primary" className={buttonPrimary} disabled={executing === action.id} onClick={() => onExecuteAction(selectedLog.id, action.id, false)}>{t("aiOpsPage.actions.execute")}</button>
												) : (
													<button type="button" data-action-button data-variant="secondary" className={buttonGhost} disabled={executing === action.id} onClick={() => onExecuteAction(selectedLog.id, action.id, false)}>{t("aiOpsPage.actions.execute")}</button>
												)}
												{canAutonomous && <button type="button" data-action-button data-variant="danger" className={buttonDanger} disabled={executing === action.id} onClick={() => onExecuteAction(selectedLog.id, action.id, true)}>{t("aiOpsPage.actions.forceAutonomous")}</button>}
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
				<div className="mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
					<div className="text-xs uppercase tracking-wide text-[var(--danger)]">{t("aiOpsPage.detail.errorMessage")}</div>
					<div className="mt-1">{selectedLog.errorMessage}</div>
				</div>
			)}
		</section>
	);
}
