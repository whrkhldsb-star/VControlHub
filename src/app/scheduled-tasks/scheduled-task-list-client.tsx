"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { EmptyState, Toolbar, SurfacePanel } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import type { Locale } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Chip, Notice, SegmentedControl } from "@/components/ui-primitives";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { PaginatedList } from "@/components/paginated-list";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { formatDateTime } from "@/lib/datetime/format";
import { APP_TIME_ZONE, appTimeZoneDateTimeLocal, zonedDateTimeToIso } from "@/lib/datetime/time-zone";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { changedTaskFields, type TaskFormValues } from "./task-changes";
import { IconCalendarClock } from "@/components/nav-icons";
import { Plus } from "@/components/icons";
import { cn } from "@/lib/ui/cn";
import { describeCron, isFiveFieldCron } from "@/lib/scheduled-task/describe-cron";

type Task = {
	id: string; name: string; cronExpression: string;
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
	return [task.name, task.cronExpression, task.command, task.reason, task.lastResult, task.status]
		.filter(Boolean)
		.some((value) => String(value).toLowerCase().includes(needle));
}

const fieldLabelClass = UI_LABEL;
const fieldInputClass = UI_INPUT;
const monoFieldInputClass = `${UI_INPUT} font-mono`;

/** Form preview: the plain reading when there is one, otherwise what to fix or expect. */
function describeCronPreview(expr: string, t: (key: string, vars?: Record<string, string | number>) => string) {
	if (!isFiveFieldCron(expr)) return t("scheduledTasks.cron.invalid");
	return describeCron(expr, t) ?? t("scheduledTasks.cron.custom");
}

export function ScheduledTaskListClient({ tasks: initialTasks, servers, templates = [], canCreate, canManage, canApprove = false }: Props) {
	// Retry/pause/delete: executors always; a creator only for tasks whose every run is approved (matches the API, A6-09).
	const canOperate = (task: { approvalRequired?: boolean }) => canManage || (canCreate && task.approvalRequired !== false);
	const { t, locale } = useI18n();
	const [tasks, setTasks] = useState(initialTasks);
	const [showCreate, setShowCreate] = useState(false);
	// The task whose changes the form holds; null while it makes a new one.
	const [editing, setEditing] = useState<Task | null>(null);
	const formPanelRef = useRef<HTMLDivElement>(null);
	// The form opens above the list: bring it into view (the edit button may be far down the page).
	useEffect(() => {
		if (showCreate) formPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
	}, [showCreate, editing]);
	const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const { addToast } = useToast();
	const { state: filters, setField: setFilter } = useUrlQueryState({ q: "" });
	const searchQuery = filters.q;

	const refresh = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/scheduled-tasks");
			setTasks(data.tasks ?? []);
		} catch (err) {
			addToast("error", getErrorMessage(err, t("scheduledTasks.refreshFailed")));
		}
	}, [addToast, t]);

	const filteredTasks = useMemo(() => tasks.filter((task) => matchesTask(task, searchQuery)), [tasks, searchQuery]);

	const toggleTask = useCallback(async (id: string) => {
		if (busyId) return;
		setBusyId(id);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ toggleId: id }),
			});
			void refresh();
		} catch (err) {
			// A toast: the notice these used to fill sat above the toolbar, off screen from a few tasks down.
			addToast("error", getErrorMessage(err, t("scheduledTasks.toggleFailed")));
		} finally {
			setBusyId(null);
		}
	}, [addToast, busyId, refresh, t]);

	const retryTask = useCallback(async (task: Task) => {
		if (busyId) return;
		setBusyId(task.id);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ retryId: task.id }),
			});
			// The request files a command request and returns: the card looked the same, with nothing to say the
			// click had been taken. Where it goes next depends on whether each run of this task is approved.
			addToast("success", t(task.approvalRequired === false ? "scheduledTasksPage.runNow.started" : "scheduledTasksPage.runNow.submitted"), {
				action: { label: t("nav.requests"), href: "/requests" },
			});
			void refresh();
		} catch (err) {
			addToast("error", getErrorMessage(err, t("scheduledTasks.retryFailed")));
		} finally {
			setBusyId(null);
		}
	}, [addToast, busyId, refresh, t]);

	const deleteTask = useCallback(async (task: Task) => {
		if (busyId) return;
		setBusyId(task.id);
		setDeleteError(null);
		try {
			await csrfFetch(`/api/scheduled-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
			setTaskPendingDelete(null);
			void refresh();
		} catch (err) {
			// The dialog stays open with the reason in it; it used to close first and leave the reason above the list.
			setDeleteError(getErrorMessage(err, t("scheduledTasks.deleteFailed")));
		} finally {
			setBusyId(null);
		}
	}, [busyId, refresh, t]);

	return (
		<div className="space-y-6">
			<Toolbar className="justify-between">
				<label htmlFor="scheduled-task-log-search" className="sr-only">{t("scheduledTasksPage.search.label")}</label>
				<input
					id="scheduled-task-log-search"
					type="search"
					value={searchQuery}
					onChange={(e) => setFilter("q", e.target.value)}
					placeholder={t("scheduledTasks.searchPlaceholder")} className={cn(UI_INPUT, "w-full sm:w-96")}
				/>
				{canCreate && !showCreate && (
					<ActionButton icon={<Plus size={16} aria-hidden />} variant="primary"
						onClick={() => setShowCreate(true)}
					>
						{t("scheduledTasksPage.create")}
						</ActionButton>
				)}
			</Toolbar>

			{showCreate && (
				<div ref={formPanelRef} className="mb-1 scroll-mt-24">
					<SurfacePanel title={editing ? t("scheduledTasksPage.editTitle", { name: editing.name }) : t("scheduledTasksPage.create")}>
						{/* Keyed by what is edited: opening another task starts from its own values. */}
						<TaskForm
							key={editing?.id ?? "new"}
							task={editing ?? undefined}
							servers={servers}
							templates={templates}
							canApprove={canApprove}
							onClose={() => { setShowCreate(false); setEditing(null); void refresh(); }}
						/>
					</SurfacePanel>
				</div>
			)}

			{tasks.length === 0 && !showCreate ? (
				<EmptyState icon={<IconCalendarClock />} variant="boxed" title={t("scheduledTasks.empty.title")} text={t("scheduledTasks.empty.hint")} />
			) : filteredTasks.length === 0 ? (
				<EmptyState text={`${t("scheduledTasksPage.search.empty", { query: searchQuery })}`} variant="boxed" />
			) : (
				<PaginatedList pageSize={20} resetKey={searchQuery} className="space-y-3">
					{filteredTasks.map((task) => (
						<article key={task.id} data-card className="p-5 transition-colors duration-150 hover:bg-[var(--surface-elevated)]">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2.5">
										<h2 className="ui-title-section">{task.name}</h2>
										<StatusBadge tone={statusTone[task.status] ?? "neutral"} size="sm">
											{statusLabelFor(task.status, t)}
										</StatusBadge>
									</div>
									<p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-[var(--text-muted)]">
										{task.scheduleType === "ONCE" ? t("scheduledTasks.schedule.once") : (
											<>
												<span>Cron{t("common.colon")}<code className="font-mono text-[var(--accent)]">{task.cronExpression}</code></span>
												{describeCron(task.cronExpression, t) ? <span>{describeCron(task.cronExpression, t)}</span> : null}
											</>
										)}
									</p>
									<div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
										<span>{task.source === "AI" ? t("scheduledTasks.source.ai") : t("scheduledTasks.source.manual")}</span>
										<span>{task.approvalRequired ? t("scheduledTasks.approval.everyRun") : t("scheduledTasks.approval.once")}</span>
										{task.runAt && <span>{t("scheduledTasks.runAt", { time: formatTime(task.runAt, locale) })}</span>}
									</div>
									<div data-inset className="mt-2.5 px-3 py-1.5 font-mono text-xs text-[var(--accent)]">
										{task.command}
									</div>
									{task.reason && <p className="mt-1.5 text-xs text-[var(--text-muted)]">{t("scheduledTasksPage.reason", { reason: task.reason })}</p>}
									{task.plan && (
										<details data-inset className="mt-2 px-3 py-2 text-xs">
											<summary className="cursor-pointer font-medium text-[var(--text-secondary)]">{t("scheduledTasks.plan")}</summary>
											<p className="mt-2 whitespace-pre-wrap break-words text-[var(--text-muted)]">{task.plan}</p>
											{task.verificationCommand && (
												<p className="mt-2 font-mono text-[var(--text-muted)]">{t("scheduledTasks.verify")}{t("common.colon")}{task.verificationCommand}</p>
											)}
											{task.rollbackCommand && (
												<p className="mt-1 font-mono text-[var(--text-muted)]">{t("scheduledTasks.rollback")}{t("common.colon")}{task.rollbackCommand}</p>
											)}
										</details>
									)}
									<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
										<div>{t("scheduledTasksPage.targetNodes", { count: task.serverIds.length })}</div>
										<div>{t("scheduledTasksPage.runCount", { count: task.runCount })}</div>
										<div>{t("scheduledTasksPage.lastRun", { time: formatTime(task.lastRunAt, locale) })}</div>
										<div>{t("scheduledTasksPage.nextRun", { time: formatTime(task.nextRunAt, locale) })}</div>
									</div>
									<div data-inset className="mt-3 px-3 py-2 text-xs text-[var(--text-muted)]">
										<div className="mb-1 font-medium text-[var(--text-secondary)]">{t("scheduledTasksPage.recentLogs")}</div>
										<div className="whitespace-pre-wrap break-words">{task.lastResult || t("scheduledTasks.empty.lastResult")}</div>
									</div>
								</div>
								<div className="flex flex-col gap-2 shrink-0">
									{canOperate(task) && (
										<ActionButton size="sm" variant="secondary"
											onClick={() => retryTask(task)} disabled={busyId !== null}>
											{t("scheduledTasksPage.retry")}
										</ActionButton>
									)}
									{/* Run, then change, then pause, then delete: the order of the playbook cards. */}
									{canOperate(task) && (
										<ActionButton size="sm" variant="secondary"
											onClick={() => { setEditing(task); setShowCreate(true); }}
											disabled={showCreate}
											title={showCreate ? t("scheduledTasksPage.editBusy") : undefined}>
											{t("scheduledTasksPage.edit")}
										</ActionButton>
									)}
									{canOperate(task) && (
										<ActionButton size="sm" variant={task.status === "ACTIVE" ? "secondary" : "success"}
											onClick={() => toggleTask(task.id)} disabled={busyId !== null}>
											{task.status === "ACTIVE" ? t("scheduledTasks.pause") : t("scheduledTasks.resume")}
										</ActionButton>
									)}
									{canOperate(task) && (
										<ActionButton size="sm" variant="danger"
											onClick={() => { setDeleteError(null); setTaskPendingDelete(task); }} disabled={busyId !== null}>
											{t("scheduledTasksPage.delete")}
										</ActionButton>
									)}
								</div>
							</div>
						</article>
					))}
				</PaginatedList>
			)}
			<ConfirmDialog
				open={taskPendingDelete !== null}
				title={t("scheduledTasksPage.delete.title")}
				description={t("scheduledTasksPage.delete.desc", { name: taskPendingDelete?.name ?? "" })}
				cancelLabel={t("scheduledTasksPage.cancel")}
				confirmLabel={t("scheduledTasksPage.delete.confirm")}
				busy={busyId !== null}
				error={deleteError}
				onCancel={() => { if (!busyId) setTaskPendingDelete(null); }}
				onConfirm={() => taskPendingDelete && deleteTask(taskPendingDelete)}
				closeOnBackdrop={false}
			/>
		</div>
	);
}

/* ── Task form ────────────────────────────────────────────── */

/**
 * A new task, or the changes to one (`task`): the same fields either way, sent as a POST or as a PATCH. A task
 * could not be changed once created: fixing a command meant deleting the task and making it again.
 */
function TaskForm({ task, servers, templates, canApprove, onClose }: { task?: Task; servers: ServerOption[]; templates: TemplateOption[]; canApprove: boolean; onClose: () => void }) {
	const { t } = useI18n();
	const { addToast } = useToast();
	const editing = task !== undefined;
	const [name, setName] = useState(task?.name ?? "");
	const [scheduleType, setScheduleType] = useState<"CRON" | "ONCE">(task?.scheduleType ?? "CRON");
	// A one-off task keeps a placeholder expression: switching it to recurring starts from the usual default.
	const [cronExpression, setCron] = useState(task && (task.scheduleType ?? "CRON") === "CRON" ? task.cronExpression : "0 3 * * *");
	const [runAt, setRunAt] = useState(task?.runAt ? appTimeZoneDateTimeLocal(new Date(task.runAt)) : "");
	const [templateId, setTemplateId] = useState("");
	const [variables, setVariables] = useState<Record<string, string>>({});
	const [command, setCommand] = useState(task?.command ?? "");
	const [reason, setReason] = useState(task?.reason ?? "");
	const [plan, setPlan] = useState(task?.plan ?? "");
	const [verificationCommand, setVerificationCommand] = useState(task?.verificationCommand ?? "");
	const [rollbackCommand, setRollbackCommand] = useState(task?.rollbackCommand ?? "");
	const [approvalRequired, setApprovalRequired] = useState(task?.approvalRequired ?? true);
	const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(() => new Set(task?.serverIds ?? []));
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Cancel asked nothing and dropped what was typed (the playbook form asks).
	const [dirty, setDirty] = useState(false);
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: onClose });
	// A task that runs without per-run approval runs what an approver signed off on: only an approver may change
	// its command or its servers. The server refused it after the fact; the fields say so before.
	const whatRunsLocked = editing && task.approvalRequired === false && !canApprove;
	const cronPreview = useMemo(() => describeCronPreview(cronExpression, t), [cronExpression, t]);
	const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
	const renderedCommand = useMemo(() => {
		let result = selectedTemplate?.command ?? command;
		for (const [key, value] of Object.entries(variables)) result = result.replaceAll(`{{${key}}}`, () => value);
		return result;
	}, [command, selectedTemplate, variables]);
	const renderedRollback = useMemo(() => {
		let result = rollbackCommand || selectedTemplate?.rollbackCommand || "";
		for (const [key, value] of Object.entries(variables)) result = result.replaceAll(`{{${key}}}`, () => value);
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
			// With servers listed and none ticked: the sentence used here said that no server was enabled.
			setError(t(enabledServers.length > 0 ? "scheduledTasks.selectTarget" : "scheduledTasks.noEnabledServers"));
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const values: TaskFormValues = {
				name,
				scheduleType,
				cronExpression,
				runAt: scheduleType === "ONCE" ? zonedDateTimeToIso(runAt) : undefined,
				command: renderedCommand,
				reason,
				plan,
				verificationCommand,
				rollbackCommand: renderedRollback,
				approvalRequired,
				templateId: templateId || undefined,
				serverIds: Array.from(selectedServerIds),
			};
			// An edit sends what changed, and nothing when nothing did.
			const changes = editing ? changedTaskFields(task, values) : null;
			if (changes && Object.keys(changes).length === 0) {
				addToast("info", t("scheduledTasksPage.unchanged"));
				setDirty(false);
				onClose();
				return;
			}
			await csrfFetch("/api/scheduled-tasks", {
				method: editing ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(editing
					? { id: task.id, ...changes }
					: {
						...values,
						plan: plan || undefined,
						verificationCommand: verificationCommand || undefined,
						rollbackCommand: renderedRollback || undefined,
					}),
			});
			addToast("success", editing ? t("scheduledTasksPage.updated", { name }) : t("scheduledTasksPage.created", { name }));
			setDirty(false);
			onClose();
		} catch (err) {
			setError(getErrorMessage(err, t(editing ? "scheduledTasks.updateFailed" : "scheduledTasks.createFailed")));
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
	// A server disabled since the task was saved is still one of its targets: listed, so it can be taken off.
	const listedServers = servers.filter((s) => s.enabled || selectedServerIds.has(s.id));
	const allEnabledSelected = enabledServers.length > 0 && enabledServers.every((s) => selectedServerIds.has(s.id));

	return (
		// The panel around it has the title: the form was a second card under a second "创建定时任务".
		<form onSubmit={handleSubmit} onChangeCapture={() => setDirty(true)} className="space-y-4">
			{error && <Notice tone="danger">{error}</Notice>}

			<SegmentedControl
				block
				ariaLabel={t("scheduledTasks.schedule.typeLabel")}
				value={scheduleType}
				onChange={(next) => { setDirty(true); setScheduleType(next); }}
				options={[
					{ value: "CRON", label: t("scheduledTasks.schedule.recurring") },
					{ value: "ONCE", label: t("scheduledTasks.schedule.once") },
				]}
			/>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-name" className={fieldLabelClass}>{t("scheduledTasksPage.name")}</label>
				<input id="scheduled-task-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("scheduledTasks.namePlaceholder")} className={fieldInputClass} />
			</div>
			{scheduleType === "CRON" ? (
				<div className="space-y-1.5">
					<label htmlFor="scheduled-task-cron" className={fieldLabelClass}>{t("scheduledTasksPage.cron")}</label>
					<input id="scheduled-task-cron" value={cronExpression} onChange={(e) => setCron(e.target.value)} required placeholder="0 3 * * *" className={monoFieldInputClass} />
					<Notice tone="info" compact>{t("scheduledTasksPage.preview.label", { value: cronPreview })}</Notice>
					<p className="text-xs text-[var(--text-muted)]">{t("scheduledTasks.timezoneApp", { timezone: APP_TIME_ZONE })}</p>
					<div className="flex flex-wrap gap-1.5">
						{presetCrons.map((p) => (
							<Chip key={p.expr} selected={cronExpression === p.expr} onClick={() => { setDirty(true); setCron(p.expr); }}>
								{p.label}
							</Chip>
						))}
					</div>
				</div>
			) : (
				<div className="space-y-1.5">
					<label htmlFor="scheduled-task-run-at" className={fieldLabelClass}>{t("scheduledTasks.runAtLabel")}</label>
					<input id="scheduled-task-run-at" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required className={fieldInputClass} />
					<p className="text-xs text-[var(--text-muted)]">{t("scheduledTasks.timezoneApp", { timezone: APP_TIME_ZONE })}</p>
				</div>
			)}

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-template" className={fieldLabelClass}>{t("scheduledTasks.template")}</label>
				<select
					id="scheduled-task-template"
					value={templateId}
					onChange={(e) => {
						const id = e.target.value;
						setTemplateId(id);
						const next = templates.find((item) => item.id === id);
						if (next) {
							setCommand(next.command);
							setRollbackCommand(next.rollbackCommand ?? "");
						}
					}}
					disabled={whatRunsLocked}
					className={fieldInputClass}
				>
					<option value="">{t("scheduledTasks.customCommand")}</option>
					{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
				</select>
			</div>
			{selectedTemplate?.variables.map((variable) => (
				<div key={variable} className="space-y-1.5">
					<label htmlFor={`scheduled-template-${variable}`} className={fieldLabelClass}>{`{{${variable}}}`}</label>
					<input
						id={`scheduled-template-${variable}`}
						value={variables[variable] ?? ""}
						onChange={(e) => setVariables((prev) => ({ ...prev, [variable]: e.target.value }))}
						required
						className={fieldInputClass}
					/>
				</div>
			))}

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-command" className={fieldLabelClass}>{t("scheduledTasksPage.command")}</label>
				<textarea
					id="scheduled-task-command"
					value={selectedTemplate ? renderedCommand : command}
					onChange={(e) => { if (!selectedTemplate) setCommand(e.target.value); }}
					readOnly={Boolean(selectedTemplate) || whatRunsLocked}
					required
					rows={3}
					placeholder="df -h"
					className={`${monoFieldInputClass} resize-y`}
				/>
				{whatRunsLocked && <p className="text-xs text-[var(--text-muted)]">{t("scheduledTasks.unattendedLocked")}</p>}
			</div>
			<div className="grid gap-3 md:grid-cols-3">
				<div className="space-y-1.5">
					<label htmlFor="scheduled-task-plan" className={fieldLabelClass}>{t("scheduledTasks.plan")}</label>
					<textarea id="scheduled-task-plan" value={plan} onChange={(e) => setPlan(e.target.value)} rows={2} className={`${fieldInputClass} resize-y`} />
				</div>
				<div className="space-y-1.5">
					<label htmlFor="scheduled-task-verify" className={fieldLabelClass}>{t("scheduledTasks.verify")}</label>
					<input id="scheduled-task-verify" value={verificationCommand} onChange={(e) => setVerificationCommand(e.target.value)} className={monoFieldInputClass} />
				</div>
				<div className="space-y-1.5">
					<label htmlFor="scheduled-task-rollback" className={fieldLabelClass}>{t("scheduledTasks.rollback")}</label>
					<input
						id="scheduled-task-rollback"
						value={renderedRollback}
						onChange={(e) => setRollbackCommand(e.target.value)}
						readOnly={Boolean(selectedTemplate?.rollbackCommand)}
						className={monoFieldInputClass}
					/>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<input
					id="scheduled-task-approval"
					type="checkbox"
					checked={approvalRequired}
					// Anyone may switch approval on; only an approver may switch it off.
					disabled={!canApprove && approvalRequired}
					onChange={(e) => setApprovalRequired(e.target.checked)}
					className="accent-[var(--color-action)]"
				/>
				<label htmlFor="scheduled-task-approval" className="ui-label">{t("scheduledTasks.approval.everyRun")}</label>
				{!canApprove && <span className="text-xs text-[var(--text-muted)]">{t("scheduledTasks.approval.permissionHint")}</span>}
			</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-reason" className={fieldLabelClass}>{t("scheduledTasksPage.reason")}</label>
				<input id="scheduled-task-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("scheduledTasks.reasonPlaceholder")} className={fieldInputClass} />
			</div>

			{enabledServers.length > 0 ? (
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div id="scheduled-task-target-nodes-label" className={fieldLabelClass}>{t("scheduledTasksPage.servers")}</div>
						<button
							type="button"
							onClick={() => { setDirty(true); setSelectedServerIds(allEnabledSelected ? new Set() : new Set(enabledServers.map((server) => server.id))); }}
							disabled={whatRunsLocked}
							className="text-xs font-medium text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
						>
							{allEnabledSelected ? t("scheduledTasks.clearSelection") : t("scheduledTasks.selectAll")}
						</button>
					</div>
					<div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-labelledby="scheduled-task-target-nodes-label">
						{listedServers.map((s) => {
							const checked = selectedServerIds.has(s.id);
							// A disabled server can only be taken off.
							const locked = whatRunsLocked || (!s.enabled && !checked);
							return (
								<label key={s.id} data-tile="" data-selected={checked ? "" : undefined} className={`flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] transition ${locked ? "cursor-not-allowed" : "cursor-pointer"} ${s.enabled ? "" : "opacity-60"}`}>
									<input type="checkbox" checked={checked} disabled={locked} onChange={() => toggleServer(s.id)} className="accent-[var(--color-action)]" />
									<span className="min-w-0 flex-1">{s.name}</span>
									{/* The space keeps the name and the mark two words when read out ("web-1 Disabled"). */}
									{!s.enabled && <>{" "}<span className="shrink-0 text-xs text-[var(--text-muted)]">{t("scheduledTasks.serverDisabled")}</span></>}
								</label>
							);
						})}
					</div>
				</div>
			) : (
				<Notice tone="warning">{t("scheduledTasks.noEnabledServers")}</Notice>
			)}

			<div className="flex gap-3 pt-2">
				<ActionButton variant="primary" type="submit" disabled={submitting || enabledServers.length === 0}>
					{editing
						? (submitting ? t("scheduledTasks.submit.saving") : t("scheduledTasks.submit.save"))
						: (submitting ? t("scheduledTasks.submit.creating") : t("scheduledTasks.submit.create"))}
				</ActionButton>
				<ActionButton variant="secondary" onClick={requestDiscard}>
					{t("scheduledTasksPage.cancel")}
				</ActionButton>
			</div>
			{discardDialog}
		</form>
	);
}
