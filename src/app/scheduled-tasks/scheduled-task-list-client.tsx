"use client";

import { Fragment, useState, useCallback, useMemo } from "react";
import { EmptyState } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Task = {
	id: string; name: string; cronExpression: string; cronDescription: string;
	command: string; reason: string | null; status: string; serverIds: string[];
	lastRunAt: string | null; nextRunAt: string | null; lastResult: string | null;
	runCount: number; createdAt: string;
	creator: { username: string; displayName: string | null } | null;
};

type ServerOption = { id: string; name: string; enabled: boolean };

type Props = {
	tasks: Task[];
	servers: ServerOption[];
	canCreate: boolean;
	canManage: boolean;
};

const statusTone: Record<string, "success" | "warning" | "neutral"> = {
	ACTIVE: "success",
	PAUSED: "warning",
	DISABLED: "neutral",
};

function statusLabelFor(status: string, t: (key: string) => string): string {
	if (status === "ACTIVE") return t("scheduledTasks.status.active");
	if (status === "PAUSED") return t("scheduledTasks.status.paused");
	if (status === "DISABLED") return t("scheduledTasks.status.disabled");
	return status;
}

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString("zh-CN");
}

function matchesTask(task: Task, query: string) {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [task.name, task.cronExpression, task.cronDescription, task.command, task.reason, task.lastResult, task.status]
		.filter(Boolean)
		.some((value) => String(value).toLowerCase().includes(needle));
}

const fieldLabelClass = "text-xs font-medium text-[var(--text-secondary)] tracking-wide";
const fieldInputClass = "w-full rounded-lg border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30";
const monoFieldInputClass = `${fieldInputClass} font-mono`;

function describeCronPreview(expr: string, t: (key: string) => string) {
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

export function ScheduledTaskListClient({ tasks: initialTasks, servers, canCreate, canManage }: Props) {
	const { t } = useI18n();
	const [tasks, setTasks] = useState(initialTasks);
	const [showCreate, setShowCreate] = useState(false);
	const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");

	const refresh = useCallback(async () => {
		const data = await csrfFetch("/api/scheduled-tasks");
		setTasks(data.tasks ?? []);
	}, []);

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
			setActionError(err instanceof Error ? err.message : t("scheduledTasks.toggleFailed"));
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
			setActionError(err instanceof Error ? err.message : t("scheduledTasks.retryFailed"));
		}
	}, [refresh, t]);

	const deleteTask = useCallback(async (task: Task) => {
		setTaskPendingDelete(null);
		setActionError(null);
		try {
			await csrfFetch(`/api/scheduled-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
			void refresh();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : t("scheduledTasks.deleteFailed"));
		}
	}, [refresh, t]);

	return (
		<div className="space-y-6">
			{actionError && <div role="alert" className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">{actionError}</div>}
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="space-y-1">
					<label htmlFor="scheduled-task-log-search" className="text-xs font-medium text-[var(--text-secondary)]">{t("scheduledTasksPage.search.label")}</label>
					<input
						id="scheduled-task-log-search"
						type="search"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder={t("scheduledTasks.searchPlaceholder")}
						data-card className="w-full min-w-[18rem]  px-3.5 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/40"
					/>
				</div>
				{canCreate && !showCreate && (
					<button
						onClick={() => setShowCreate(true)}
						data-tone="accent"
						className="min-h-11 rounded-2xl border px-5 py-2.5 text-sm font-medium transition"
					>
						{t("scheduledTasksPage.create")}
						</button>
				)}
			</div>

			{showCreate && (
				<CreateTaskForm servers={servers} onClose={() => { setShowCreate(false); void refresh(); }} />
			)}

			{tasks.length === 0 && !showCreate ? (
				<EmptyState icon="⏰" text={t("scheduledTasks.empty.title")} variant="boxed" />
			) : filteredTasks.length === 0 ? (
				<EmptyState text={`${t("scheduledTasksPage.search.empty").replace("{query}", searchQuery)}`} variant="boxed" />
			) : (
				<div className="space-y-3">
					{filteredTasks.map((task) => (
						<article key={task.id} data-card className=" hover:bg-[var(--surface)]/[0.04] transition-colors duration-150">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2.5">
										<h2 className="text-lg font-semibold text-[var(--text-primary)]">{task.name}</h2>
										<span data-tone={statusTone[task.status] ?? "neutral"} className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium">
											{statusLabelFor(task.status, t)}
										</span>
									</div>
									<p className="mt-1 text-xs text-[var(--text-muted)]">Cron: <code className="text-[var(--color-action)] font-mono">{task.cronExpression}</code> — {task.cronDescription}</p>
									<div className="mt-2.5 rounded-lg bg-[var(--surface-subtle)] px-3 py-1.5 font-mono text-xs text-[var(--color-action)] border border-[var(--border)]">
										{task.command}
									</div>
									{task.reason && <p className="mt-1.5 text-xs text-[var(--text-muted)]">{t("scheduledTasksPage.reason").replace("{reason}", task.reason)}</p>}
									<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
										<div>{t("scheduledTasksPage.targetNodes").replace("{count}", String(task.serverIds.length))}</div>
										<div>{t("scheduledTasksPage.runCount").replace("{count}", String(task.runCount))}</div>
										<div>{t("scheduledTasksPage.lastRun").replace("{time}", formatTime(task.lastRunAt))}</div>
										<div>{t("scheduledTasksPage.nextRun").replace("{time}", formatTime(task.nextRunAt))}</div>
									</div>
									<div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
										<div className="mb-1 font-medium text-[var(--text-secondary)]">{t("scheduledTasksPage.recentLogs")}</div>
										<div className="whitespace-pre-wrap break-words">{task.lastResult || t("scheduledTasks.empty.lastResult")}</div>
									</div>
								</div>
								<div className="flex flex-col gap-2 shrink-0">
									{canManage && (
										<button
											onClick={() => retryTask(task.id)}
											data-tone="accent"
											className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition"
										>
											{t("scheduledTasksPage.retry")}
											</button>
									)}
									{canManage && (
										<button
											onClick={() => toggleTask(task.id)}
											data-tone={task.status === "ACTIVE" ? "warning" : "success"}
											className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition"
										>
											{task.status === "ACTIVE" ? t("scheduledTasks.pause") : t("scheduledTasks.resume")}
										</button>
									)}
									{canManage && (
										<button
											onClick={() => setTaskPendingDelete(task)}
											data-tone="danger"
											className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition"
										>
											{t("scheduledTasksPage.delete")}
											</button>
									)}
								</div>
							</div>
						</article>
					))}
				</div>
			)}
			{taskPendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm" role="presentation">
					<section role="dialog" aria-modal="true" aria-labelledby="delete-scheduled-task-title" className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
						<h2 id="delete-scheduled-task-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("scheduledTasksPage.delete.title")}</h2>
						<p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
							<Fragment>{t("scheduledTasksPage.delete.descPrefix")}<strong className="font-semibold text-[var(--text-primary)]">{taskPendingDelete.name}</strong>{t("scheduledTasksPage.delete.descSuffix")}</Fragment>
						</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button type="button" onClick={() => setTaskPendingDelete(null)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
								{t("scheduledTasksPage.cancel")}
							</button>
							<button type="button" onClick={() => deleteTask(taskPendingDelete)} className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger)]">
								{t("scheduledTasksPage.delete.confirm")}
							</button>
						</div>
					</section>
				</div>
			)}
		</div>
	);
}

/* ── Create form ──────────────────────────────────────────── */

function CreateTaskForm({ servers, onClose }: { servers: ServerOption[]; onClose: () => void }) {
	const { t } = useI18n();
	const [name, setName] = useState("");
	const [cronExpression, setCron] = useState("0 3 * * *");
	const [command, setCommand] = useState("");
	const [reason, setReason] = useState("");
	const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cronPreview = useMemo(() => describeCronPreview(cronExpression, t), [cronExpression, t]);

	const toggleServer = (id: string) => {
		setSelectedServerIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			await csrfFetch("/api/scheduled-tasks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					cronExpression,
					command,
					reason,
					serverIds: Array.from(selectedServerIds),
				}),
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("scheduledTasks.createFailed"));
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
		<form onSubmit={handleSubmit} data-card className=" space-y-4">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("scheduledTasksPage.createTitle")}</h3>
			{error && <div role="alert" className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)]">{error}</div>}

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-name" className={fieldLabelClass}>{t("scheduledTasksPage.name")}</label>
				<input id="scheduled-task-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t("scheduledTasks.namePlaceholder")} className={fieldInputClass} />
			</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-cron" className={fieldLabelClass}>{t("scheduledTasksPage.cron")}</label>
				<input id="scheduled-task-cron" value={cronExpression} onChange={(e) => setCron(e.target.value)} required placeholder="0 3 * * *" className={monoFieldInputClass} />
				<p data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/10 px-3 py-2 text-xs text-[var(--text-primary)]">{t("scheduledTasksPage.preview.label").replace("{value}", cronPreview)}</p>
				<div className="flex flex-wrap gap-1.5">
					{presetCrons.map((p) => (
						<button key={p.expr} type="button" onClick={() => setCron(p.expr)}
							className={`min-h-11 rounded-lg border px-2.5 py-1 text-[11px] transition ${
								cronExpression === p.expr
									? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
									: "border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.04]"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-command" className={fieldLabelClass}>{t("scheduledTasksPage.command")}</label>
				<textarea id="scheduled-task-command" value={command} onChange={(e) => setCommand(e.target.value)} required rows={3} placeholder="df -h" className={`${monoFieldInputClass} resize-y`} />
			</div>

			<div className="space-y-1.5">
				<label htmlFor="scheduled-task-reason" className={fieldLabelClass}>{t("scheduledTasksPage.reason")}</label>
				<input id="scheduled-task-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("scheduledTasks.reasonPlaceholder")} className={fieldInputClass} />
			</div>

			{enabledServers.length > 0 && (
				<div className="space-y-1.5">
					<div id="scheduled-task-target-nodes-label" className={fieldLabelClass}>{t("scheduledTasksPage.servers")}</div>
					<div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-labelledby="scheduled-task-target-nodes-label">
						{enabledServers.map((s) => (
							<label key={s.id} className={`min-h-11 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
								selectedServerIds.has(s.id) ? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)]" : "border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"
							}`}>
								<input type="checkbox" checked={selectedServerIds.has(s.id)} onChange={() => toggleServer(s.id)} className="accent-[var(--color-action)]" />
								<span>{s.name}</span>
							</label>
						))}
					</div>
				</div>
			)}

			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="min-h-11 rounded-2xl bg-[var(--color-action)] px-5 py-2 text-sm font-medium text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:opacity-60">
					{submitting ? t("scheduledTasks.submit.creating") : t("scheduledTasks.submit.create")}
				</button>
				<button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-[var(--border)] px-5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface)]/10 transition">
					{t("scheduledTasksPage.cancel")}
				</button>
			</div>
		</form>
	);
}
