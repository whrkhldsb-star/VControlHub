"use client";

import { useState, useCallback, useMemo } from "react";
import { EmptyState, Toolbar, SurfacePanel } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Locale } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { PaginatedList } from "@/components/paginated-list";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { formatDateTime } from "@/lib/datetime/format";
import { APP_TIME_ZONE, zonedDateTimeToIso } from "@/lib/datetime/time-zone";

type Task = {
	id: string; name: string; cronExpression: string; cronDescription: string;
	scheduleType?: "CRON" | "ONCE"; runAt?: string | null;
	command: string; reason: string | null; status: string; serverIds: string[];
	plan?: string | null; verificationCommand?: string | null; rollbackCommand?: string | null;
	approvalRequired?: boolean; source?: string; templateId?: string | null;
	lastRunAt: string | null; nextRunAt: string | null; lastResult: string | null;
	runCount: number; createdAt: string;
	creator: { username: string; displayName: string | null } | null;
};

type ServerOption = { id: string; name: string; enabled: boolean };
type TemplateOption = { id: string; name: string; description: string | null; command: string; rollbackCommand: string | null; variables: string[]; tags: string[] };

type Props = {
	tasks: Task[];
	servers: ServerOption[];
	templates?: TemplateOption[];
	canCreate: boolean;
	canManage: boolean;
	canApprove?: boolean;
};

const statusTone: Record<string, "success" | "warning" | "neutral"> = {
	ACTIVE: "success",
	PAUSED: "warning",
	DISABLED: "neutral",
};

function statusLabelFor(status: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
	if (status === "ACTIVE") return t("scheduledTasks.status.active");
	if (status === "PAUSED") return t("scheduledTasks.status.paused");
	if (status === "DISABLED") return t("scheduledTasks.status.disabled");
	return status;
}

function formatTime(iso: string | null, locale?: Locale): string {
	if (!iso) return "—";
	return formatDateTime(iso, locale ?? "zh");
}

function matchesTask(task: Task, query: string) {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [task.name, task.cronExpression, task.cronDescription, task.command, task.reason, task.lastResult, task.status]
		.filter(Boolean)
		.some((value) => String(value).toLowerCase().includes(needle));
}

const fieldLabelClass = "text-xs font-medium text-[var(--text-secondary)] tracking-wide";
const fieldInputClass = "w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)]";
const monoFieldInputClass = `${fieldInputClass} font-mono`;

function describeCronPreview(expr: string, t: (key: string, vars?: Record<string, string | number>) => string) {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return t("scheduledTasks.cron.invalid");
	const [min, hour, day, month, dow] = parts;
	if (min!.startsWith("*/") && hour === "*" && day === "*" && month === "*" && dow === "*") return `${t("scheduledTasks.cron.intervalPrefix")}${min!.slice(2)}${t("scheduledTasks.cron.intervalMiddle")}`;
	if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*") return t("scheduledTasks.cron.hourly");
	if (day === "*" && month === "*" && dow === "*" && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) return `${t("scheduledTasks.cron.dailyPrefix")} ${hour!}:${min!.padStart(2, "0")} ${t("scheduledTasks.cron.dailySuffix")}`.trim();
	if (day === "*" && month === "*" && /^\d+$/.test(dow!) && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) {
		const weekdayKey = `scheduledTasks.weekday.${dow}`;
		const wd = t(weekdayKey);
		return `${t("scheduledTasks.cron.weeklyPrefix")}${wd} ${hour!}:${min!.padStart(2, "0")} ${t("scheduledTasks.cron.weeklySuffix")}`.trim();
	}
	return t("scheduledTasks.cron.custom");
}

export function ScheduledTaskListClient({ tasks: initialTasks, servers, templates = [], canCreate, canManage, canApprove = false }: Props) {
	const { t, locale } = useI18n();
	const [tasks, setTasks] = useState(initialTasks);
	const [showCreate, setShowCreate] = useState(false);
	const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const { state: filters, setField: setFilter } = useUrlQueryState({ q: "" });
	const searchQuery = filters.q;

	const refresh = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/scheduled-tasks");
			setTasks(data.tasks ?? []);
		} catch (err) {
			setActionError(getErrorMessage(err, t("scheduledTasks.refreshFailed")));
		}
	}, [t]);

	const filteredTasks = useMemo(() => tasks.filter((task) => matchesTask(task, searchQuery)), [tasks, searchQuery]);

	const toggleTask = useCallback(async (id: string) => {
		setActionError(null);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ toggleId: id }),
			});
			void refresh();
		} catch (err) {
			setActionError(getErrorMessage(err, t("scheduledTasks.toggleFailed")));
		}
	}, [refresh, t]);

	const retryTask = useCallback(async (id: string) => {
		setActionError(null);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ retryId: id }),
			});
			void refresh();
		} catch (err) {
			setActionError(getErrorMessage(err, t("scheduledTasks.retryFailed")));
		}
	}, [refresh, t]);

	const deleteTask = useCallback(async (task: Task) => {
		setTaskPendingDelete(null);
		setActionError(null);
		try {
			await csrfFetch(`/api/scheduled-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
			void refresh();
		} catch (err) {
			setActionError(getErrorMessage(err, t("scheduledTasks.deleteFailed")));
		}
	}, [refresh, t]);

	return (
		<div className="space-y-6">
			{actionError && <Notice tone="danger">{actionError}</Notice>}
			<Toolbar className="flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="space-y-1">
					<label htmlFor="scheduled-task-log-search" className="text-xs font-medium text-[var(--text-secondary)]">{t("scheduledTasksPage.search.label")}</label>
					<input
						id="scheduled-task-log-search"
						type="search"
						value={searchQuery}
						onChange={(e) => setFilter("q", e.target.value)}
						placeholder={t("scheduledTasks.searchPlaceholder")}
						data-input className="w-full min-w-[18rem] rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)]"
					/>
				</div>
				{canCreate && !showCreate && (
					<ActionButton variant="primary"
						onClick={() => setShowCreate(true)}
						data-primary className="min-h-11 px-5 py-2.5 text-sm"
					>
						{t("scheduledTasksPage.create")}
						</ActionButton>
				)}
			</Toolbar>

			{showCreate && (
				<div className="mb-1">
					<SurfacePanel title={t("scheduledTasksPage.create")}>
						<CreateTaskForm servers={servers} templates={templates} canApprove={canApprove} onClose={() => { setShowCreate(false); void refresh(); }} />
					</SurfacePanel>
				</div>
			)}

			{tasks.length === 0 && !showCreate ? (
				<EmptyState icon="⏰" variant="boxed">
					<div className="space-y-2">
						<p>{t("scheduledTasks.empty.title")}</p>
						<p className="text-xs text-[var(--text-muted)]">{t("scheduledTasks.empty.hint")}</p>
					</div>
				</EmptyState>
			) : filteredTasks.length === 0 ? (
				<EmptyState text={`${t("scheduledTasksPage.search.empty", { query: searchQuery })}`} variant="boxed" />
			) : (
				<PaginatedList pageSize={20} resetKey={searchQuery} className="space-y-3">
					{filteredTasks.map((task) => (
						<article key={task.id} data-card className="p-5 transition-colors duration-150 hover:bg-[var(--surface-elevated)]">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2.5">
										<h2 className="text-lg font-semibold text-[var(--text-primary)]">{task.name}</h2>
										<span data-tone={statusTone[task.status] ?? "neutral"} className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium">
											{statusLabelFor(task.status, t)}
										</span>
									</div>
									<p className="mt-1 text-xs text-[var(--text-muted)]">{task.scheduleType === "ONCE" ? t("scheduledTasks.schedule.once") : <>Cron: <code className="font-mono text-[var(--accent)]">{task.cronExpression}</code> — {task.cronDescription}</>}</p>
									<div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
										<span>{task.source === "AI" ? t("scheduledTasks.source.ai") : t("scheduledTasks.source.manual")}</span>
										<span>{task.approvalRequired ? t("scheduledTasks.approval.everyRun") : t("scheduledTasks.approval.once")}</span>
										{task.runAt && <span>{t("scheduledTasks.runAt", { time: formatTime(task.runAt, locale) })}</span>}
									</div>
									<div className="mt-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--accent)]">
										{task.command}
									</div>
									{task.reason && <p className="mt-1.5 text-xs text-[var(--text-muted)]">{t("scheduledTasksPage.reason", { reason: task.reason })}</p>}
									{task.plan && <details className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-[var(--text-secondary)]">{t("scheduledTasks.plan")}</summary><p className="mt-2 whitespace-pre-wrap break-words text-[var(--text-muted)]">{task.plan}</p>{task.verificationCommand && <p className="mt-2 font-mono text-[var(--text-muted)]">{t("scheduledTasks.verify")}: {task.verificationCommand}</p>}{task.rollbackCommand && <p className="mt-1 font-mono text-[var(--text-muted)]">{t("scheduledTasks.rollback")}: {task.rollbackCommand}</p>}</details>}
									<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
										<div>{t("scheduledTasksPage.targetNodes", { count: task.serverIds.length })}</div>
										<div>{t("scheduledTasksPage.runCount", { count: task.runCount })}</div>
										<div>{t("scheduledTasksPage.lastRun", { time: formatTime(task.lastRunAt, locale) })}</div>
										<div>{t("scheduledTasksPage.nextRun", { time: formatTime(task.nextRunAt, locale) })}</div>
									</div>
									<div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
										<div className="mb-1 font-medium text-[var(--text-secondary)]">{t("scheduledTasksPage.recentLogs")}</div>
										<div className="whitespace-pre-wrap break-words">{task.lastResult || t("scheduledTasks.empty.lastResult")}</div>
									</div>
								</div>
								<div className="flex flex-col gap-2 shrink-0">
									{canManage && (
										<ActionButton type="button" variant="outline"
											onClick={() => retryTask(task.id)}
										
											className="!min-h-11 !rounded-2xl !px-4 !py-2 !text-xs"
										>
											{t("scheduledTasksPage.retry")}
										</ActionButton>
									)}
									{canManage && (
										<ActionButton type="button" variant={task.status === "ACTIVE" ? "outline" : "success"}
											onClick={() => toggleTask(task.id)}
										
											className="!min-h-11 !rounded-2xl !px-4 !py-2 !text-xs"
										>
											{task.status === "ACTIVE" ? t("scheduledTasks.pause") : t("scheduledTasks.resume")}
										</ActionButton>
									)}
									{canManage && (
										<ActionButton type="button" variant="danger"
											onClick={() => setTaskPendingDelete(task)}
										
											className="!min-h-11 !rounded-2xl !px-4 !py-2 !text-xs"
										>
											{t("scheduledTasksPage.delete")}
										</ActionButton>
									)}
								</div>
							</div>
						</article>
					))}
				</PaginatedList>
			)}
			<ConfirmDialog open={taskPendingDelete !== null} title={t("scheduledTasksPage.delete.title")} description={<>{t("scheduledTasksPage.delete.descPrefix")}<strong className="font-semibold text-[var(--text-primary)]">{taskPendingDelete?.name}</strong>{t("scheduledTasksPage.delete.descSuffix")}</>} cancelLabel={t("scheduledTasksPage.cancel")} confirmLabel={t("scheduledTasksPage.delete.confirm")} onCancel={() => setTaskPendingDelete(null)} onConfirm={() => taskPendingDelete && deleteTask(taskPendingDelete)} closeOnBackdrop={false} />
		</div>
	);
}

/* ── Create form ──────────────────────────────────────────── */

function CreateTaskForm({ servers, templates, canApprove, onClose }: { servers: ServerOption[]; templates: TemplateOption[]; canApprove: boolean; onClose: () => void }) {
		const { t } = useI18n();
	const [name, setName] = useState("");
	const [scheduleType, setScheduleType] = useState<"CRON" | "ONCE">("CRON");
	const [cronExpression, setCron] = useState("0 3 * * *");
	const [runAt, setRunAt] = useState("");
	const [templateId, setTemplateId] = useState("");
	const [variables, setVariables] = useState<Record<string, string>>({});
	const [command, setCommand] = useState("");
	const [reason, setReason] = useState("");
	const [plan, setPlan] = useState("");
	const [verificationCommand, setVerificationCommand] = useState("");
	const [rollbackCommand, setRollbackCommand] = useState("");
	const [approvalRequired, setApprovalRequired] = useState(true);
	const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cronPreview = useMemo(() => describeCronPreview(cronExpression, t), [cronExpression, t]);
	const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
	const renderedCommand = useMemo(() => {
		let result = selectedTemplate?.command ?? command;
		for (const [key, value] of Object.entries(variables)) result = result.replaceAll(`{{${key}}}`, value);
		return result;
	}, [command, selectedTemplate, variables]);
	const renderedRollback = useMemo(() => {
		let result = rollbackCommand || selectedTemplate?.rollbackCommand || "";
		for (const [key, value] of Object.entries(variables)) result = result.replaceAll(`{{${key}}}`, value);
		return result;
	}, [rollbackCommand, selectedTemplate, variables]);

	const toggleServer = (id: string) => {
		setSelectedServerIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (selectedServerIds.size === 0) {
			setError(t("scheduledTasks.noEnabledServers"));
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					scheduleType,
					cronExpression,
				runAt: scheduleType === "ONCE" ? zonedDateTimeToIso(runAt) : undefined,
					command: renderedCommand,
					reason,
					plan: plan || undefined,
					verificationCommand: verificationCommand || undefined,
					rollbackCommand: renderedRollback || undefined,
					approvalRequired,
					templateId: templateId || undefined,
					serverIds: Array.from(selectedServerIds),
				}),
			});
			onClose();
		} catch (err) {
			setError(getErrorMessage(err, t("scheduledTasks.createFailed")));
		} finally {
			setSubmitting(false);
		}
	};

	const presetCrons = [
		{ label: t("scheduledTasks.preset.hourly"), expr: "0 * * * *" },
		{ label: t("scheduledTasks.preset.daily3am"), expr: "0 3 * * *" },
		{ label: t("scheduledTasks.preset.dailyMidnight"), expr: "0 0 * * *" },
		{ label: t("scheduledTasks.preset.weeklyMon9am"), expr: "0 9 * * 1" },
		{ label: t("scheduledTasks.preset.monthly1st"), expr: "0 0 1 * *" },
		{ label: t("scheduledTasks.preset.every5min"), expr: "*/5 * * * *" },
	];

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<form onSubmit={handleSubmit} data-card className="space-y-4 p-5">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("scheduledTasksPage.createTitle")}</h3>
			{error && <Notice tone="danger">{error}</Notice>}

			<div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
				{(["CRON", "ONCE"] as const).map((mode) => <button key={mode} type="button" aria-pressed={scheduleType === mode} onClick={() => setScheduleType(mode)} className={`min-h-10 rounded-md px-3 text-xs font-medium ${scheduleType === mode ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]"}`}>{mode === "CRON" ? t("scheduledTasks.schedule.recurring") : t("scheduledTasks.schedule.once")}</button>)}
			</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-name" className={fieldLabelClass}>{t("scheduledTasksPage.name")}</label>
				<input id="scheduled-task-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("scheduledTasks.namePlaceholder")} className={fieldInputClass} />
			</div>
			{scheduleType === "CRON" ? <div className="space-y-1.5">
				<label htmlFor="scheduled-task-cron" className={fieldLabelClass}>{t("scheduledTasksPage.cron")}</label>
				<input id="scheduled-task-cron" value={cronExpression} onChange={(e) => setCron(e.target.value)} required placeholder="0 3 * * *" className={monoFieldInputClass} />
				<p className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--text-primary)]">{t("scheduledTasksPage.preview.label", { value: cronPreview })}</p>
				<p className="text-[11px] text-[var(--text-muted)]">{t("scheduledTasks.timezoneApp", { timezone: APP_TIME_ZONE })}</p>
				<div className="flex flex-wrap gap-1.5">
					{presetCrons.map((p) => (
						<button key={p.expr} type="button" onClick={() => setCron(p.expr)}
							className={`min-h-11 rounded-lg border px-2.5 py-1 text-[11px] transition ${
								cronExpression === p.expr
									? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
									: "border-[var(--border)]/[0.10] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
			</div> : <div className="space-y-1.5"><label htmlFor="scheduled-task-run-at" className={fieldLabelClass}>{t("scheduledTasks.runAtLabel")}</label><input id="scheduled-task-run-at" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required className={fieldInputClass} /><p className="text-[11px] text-[var(--text-muted)]">{t("scheduledTasks.timezoneApp", { timezone: APP_TIME_ZONE })}</p></div>}

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-template" className={fieldLabelClass}>{t("scheduledTasks.template")}</label>
				<select id="scheduled-task-template" value={templateId} onChange={(e) => { const id = e.target.value; setTemplateId(id); const next = templates.find((item) => item.id === id); if (next) { setCommand(next.command); setRollbackCommand(next.rollbackCommand ?? ""); } }} className={fieldInputClass}><option value="">{t("scheduledTasks.customCommand")}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
			</div>
			{selectedTemplate?.variables.map((variable) => <div key={variable} className="space-y-1.5"><label htmlFor={`scheduled-template-${variable}`} className={fieldLabelClass}>{`{{${variable}}}`}</label><input id={`scheduled-template-${variable}`} value={variables[variable] ?? ""} onChange={(e) => setVariables((prev) => ({ ...prev, [variable]: e.target.value }))} required className={fieldInputClass} /></div>)}

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-command" className={fieldLabelClass}>{t("scheduledTasksPage.command")}</label>
				<textarea id="scheduled-task-command" value={selectedTemplate ? renderedCommand : command} onChange={(e) => { if (!selectedTemplate) setCommand(e.target.value); }} readOnly={Boolean(selectedTemplate)} required rows={3} placeholder="df -h" className={`${monoFieldInputClass} resize-y`} />
			</div>
			<div className="grid gap-3 md:grid-cols-3"><div className="space-y-1.5"><label htmlFor="scheduled-task-plan" className={fieldLabelClass}>{t("scheduledTasks.plan")}</label><textarea id="scheduled-task-plan" value={plan} onChange={(e) => setPlan(e.target.value)} rows={2} className={`${fieldInputClass} resize-y`} /></div><div className="space-y-1.5"><label htmlFor="scheduled-task-verify" className={fieldLabelClass}>{t("scheduledTasks.verify")}</label><input id="scheduled-task-verify" value={verificationCommand} onChange={(e) => setVerificationCommand(e.target.value)} className={monoFieldInputClass} /></div><div className="space-y-1.5"><label htmlFor="scheduled-task-rollback" className={fieldLabelClass}>{t("scheduledTasks.rollback")}</label><input id="scheduled-task-rollback" value={renderedRollback} onChange={(e) => setRollbackCommand(e.target.value)} readOnly={Boolean(selectedTemplate?.rollbackCommand)} className={monoFieldInputClass} /></div></div>
			<div className="flex flex-wrap items-center gap-2"><input id="scheduled-task-approval" type="checkbox" checked={approvalRequired} disabled={!canApprove} onChange={(e) => setApprovalRequired(e.target.checked)} className="accent-[var(--color-action)]" /><label htmlFor="scheduled-task-approval" className="text-xs text-[var(--text-secondary)]">{t("scheduledTasks.approval.everyRun")}</label>{!canApprove && <span className="text-[11px] text-[var(--text-muted)]">{t("scheduledTasks.approval.permissionHint")}</span>}</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-reason" className={fieldLabelClass}>{t("scheduledTasksPage.reason")}</label>
				<input id="scheduled-task-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("scheduledTasks.reasonPlaceholder")} className={fieldInputClass} />
			</div>

			{enabledServers.length > 0 ? (
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center justify-between gap-2"><div id="scheduled-task-target-nodes-label" className={fieldLabelClass}>{t("scheduledTasksPage.servers")}</div><button type="button" onClick={() => setSelectedServerIds(selectedServerIds.size === enabledServers.length ? new Set() : new Set(enabledServers.map((server) => server.id)))} className="text-xs font-medium text-[var(--accent)] hover:underline">{selectedServerIds.size === enabledServers.length ? t("scheduledTasks.clearSelection") : t("scheduledTasks.selectAll")}</button></div>
					<div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-labelledby="scheduled-task-target-nodes-label">
						{enabledServers.map((s) => (
							<label key={s.id} className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
								selectedServerIds.has(s.id) ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
							}`}>
								<input type="checkbox" checked={selectedServerIds.has(s.id)} onChange={() => toggleServer(s.id)} className="accent-[var(--color-action)]" />
								<span>{s.name}</span>
							</label>
						))}
					</div>
				</div>
			) : (
				<Notice tone="warning">{t("scheduledTasks.noEnabledServers")}</Notice>
			)}

			<div className="flex gap-3 pt-2">
				<ActionButton variant="primary" type="submit" disabled={submitting || enabledServers.length === 0} className="min-h-11 px-5 py-2.5 text-sm">
					{submitting ? t("scheduledTasks.submit.creating") : t("scheduledTasks.submit.create")}
				</ActionButton>
				<ActionButton variant="secondary" onClick={onClose} className="min-h-11">
					{t("scheduledTasksPage.cancel")}
				</ActionButton>
			</div>
		</form>
	);
}
