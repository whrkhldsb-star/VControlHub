"use client";

import { useState, useCallback, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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

const statusBadge: Record<string, string> = {
	ACTIVE: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 light:text-emerald-800",
	PAUSED: "border-amber-400/20 bg-amber-400/10 text-amber-200 light:text-amber-800",
	DISABLED: "border-slate-400/20 bg-slate-400/10 text-slate-200 light:text-slate-700",
};

const statusLabel: Record<string, string> = {
	ACTIVE: "运行中",
	PAUSED: "已暂停",
	DISABLED: "已禁用",
};

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

function describeCronPreview(expr: string) {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return "请输入 5 段 Cron 表达式：分钟 小时 日期 月份 星期";
	const [min, hour, day, month, dow] = parts;
	if (min.startsWith("*/") && hour === "*" && day === "*" && month === "*" && dow === "*") return `每 ${min.slice(2)} 分钟执行一次`;
	if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*") return "每小时整点执行";
	if (day === "*" && month === "*" && dow === "*" && /^\d+$/.test(hour) && /^\d+$/.test(min)) return `每天 ${hour}:${min.padStart(2, "0")} 执行`;
	if (day === "*" && month === "*" && /^\d+$/.test(dow) && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
		const names: Record<string, string> = { "0": "周日", "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六" };
		return `每${names[dow] ?? `周${dow}`} ${hour}:${min.padStart(2, "0")} 执行`;
	}
	return "自定义 Cron；保存时服务端会计算下一次运行时间";
}

export function ScheduledTaskListClient({ tasks: initialTasks, servers, canCreate, canManage }: Props) {
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
			setActionError(err instanceof Error ? err.message : "切换定时任务状态失败");
		}
	}, [refresh]);

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
			setActionError(err instanceof Error ? err.message : "重试定时任务失败");
		}
	}, [refresh]);

	const deleteTask = useCallback(async (task: Task) => {
		setTaskPendingDelete(null);
		setActionError(null);
		try {
			await csrfFetch(`/api/scheduled-tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
			void refresh();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "删除定时任务失败");
		}
	}, [refresh]);

	return (
		<div className="space-y-6">
			{actionError && <div role="alert" className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200 light:text-rose-800">{actionError}</div>}
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="space-y-1">
					<label htmlFor="scheduled-task-log-search" className="text-xs font-medium text-slate-400 light:text-slate-600">搜索定时任务 / 执行日志</label>
					<input
						id="scheduled-task-log-search"
						type="search"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="按名称、命令、Cron、上次结果搜索"
						className="w-full min-w-[18rem] rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm text-white light:text-slate-900 outline-none placeholder:text-white/25 light:placeholder:text-slate-400 focus:border-cyan-400/40"
					/>
				</div>
				{canCreate && !showCreate && (
					<button
						onClick={() => setShowCreate(true)}
						className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 light:text-cyan-900 hover:bg-cyan-400/20 transition"
					>
						+ 创建定时任务
					</button>
				)}
			</div>

			{showCreate && (
				<CreateTaskForm servers={servers} onClose={() => { setShowCreate(false); void refresh(); }} />
			)}

			{tasks.length === 0 && !showCreate ? (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
					<div className="text-4xl mb-3">⏰</div>
					<p className="text-sm text-slate-500">暂无定时任务</p>
				</div>
			) : filteredTasks.length === 0 ? (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-slate-500">没有匹配“{searchQuery}”的定时任务或执行日志</div>
			) : (
				<div className="space-y-3">
					{filteredTasks.map((task) => (
						<article key={task.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors duration-150">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2.5">
										<h2 className="text-lg font-semibold text-white light:text-slate-900">{task.name}</h2>
										<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge[task.status] ?? statusBadge.DISABLED}`}>
											{statusLabel[task.status] ?? task.status}
										</span>
									</div>
									<p className="mt-1 text-xs text-slate-500">Cron: <code className="text-cyan-300 light:text-cyan-700/70 font-mono">{task.cronExpression}</code> — {task.cronDescription}</p>
									<div className="mt-2.5 rounded-lg bg-slate-950/60 light:bg-white/60 px-3 py-1.5 font-mono text-xs text-cyan-100/80 light:text-cyan-900/80 border border-white/[0.04]">
										{task.command}
									</div>
									{task.reason && <p className="mt-1.5 text-xs text-slate-500">原因：{task.reason}</p>}
									<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
										<div>目标节点：{task.serverIds.length} 台</div>
										<div>已执行：{task.runCount} 次</div>
										<div>上次运行：{formatTime(task.lastRunAt)}</div>
										<div>下次运行：{formatTime(task.nextRunAt)}</div>
									</div>
									<div className="mt-3 rounded-lg border border-white/[0.05] bg-slate-950/40 light:bg-slate-50 px-3 py-2 text-[11px] text-slate-400 light:text-slate-700">
										<div className="mb-1 font-medium text-slate-300 light:text-slate-800">最近执行日志</div>
										<div className="whitespace-pre-wrap break-words">{task.lastResult || "暂无执行记录"}</div>
									</div>
								</div>
								<div className="flex flex-col gap-2 shrink-0">
									{canManage && (
										<button
											onClick={() => retryTask(task.id)}
											className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-medium text-cyan-100 light:text-cyan-900 hover:bg-cyan-400/20 transition"
										>
											重试
										</button>
									)}
									{canManage && (
										<button
											onClick={() => toggleTask(task.id)}
											className={`rounded-2xl border px-4 py-2 text-xs font-medium transition ${
												task.status === "ACTIVE"
													? "border-amber-400/30 bg-amber-400/10 text-amber-100 light:text-amber-900 hover:bg-amber-400/20"
													: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 light:text-emerald-900 hover:bg-emerald-400/20"
											}`}
										>
											{task.status === "ACTIVE" ? "暂停" : "恢复"}
										</button>
									)}
									{canManage && (
										<button
											onClick={() => setTaskPendingDelete(task)}
											className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-medium text-rose-100 light:text-rose-900 hover:bg-rose-400/20 transition"
										>
											删除
										</button>
									)}
								</div>
							</div>
						</article>
					))}
				</div>
			)}
			{taskPendingDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 light:bg-white/70 px-4 backdrop-blur-sm" role="presentation">
					<section role="dialog" aria-modal="true" aria-labelledby="delete-scheduled-task-title" className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-slate-950 light:bg-white p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
						<h2 id="delete-scheduled-task-title" className="text-lg font-semibold text-white light:text-slate-900">确认删除定时任务</h2>
						<p className="mt-3 text-sm leading-6 text-slate-300 light:text-slate-700">
							即将删除定时任务 <span className="font-semibold text-rose-100 light:text-rose-900">{taskPendingDelete.name}</span>。删除后该任务将停止调度，历史结果不会再通过此任务入口追踪。
						</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button type="button" onClick={() => setTaskPendingDelete(null)} className="rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-medium text-slate-200 light:text-slate-800 hover:bg-white/[0.06]">
								取消
							</button>
							<button type="button" onClick={() => deleteTask(taskPendingDelete)} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white light:text-slate-900 hover:bg-rose-400">
								确认删除
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
	const [name, setName] = useState("");
	const [cronExpression, setCron] = useState("0 3 * * *");
	const [command, setCommand] = useState("");
	const [reason, setReason] = useState("");
	const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cronPreview = useMemo(() => describeCronPreview(cronExpression), [cronExpression]);

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
			setError(err instanceof Error ? err.message : "创建失败");
		} finally {
			setSubmitting(false);
		}
	};

	const presetCrons = [
		{ label: "每小时", expr: "0 * * * *" },
		{ label: "每天 3:00", expr: "0 3 * * *" },
		{ label: "每天 0:00", expr: "0 0 * * *" },
		{ label: "每周一 9:00", expr: "0 9 * * 1" },
		{ label: "每月1日 0:00", expr: "0 0 1 * *" },
		{ label: "每5分钟", expr: "*/5 * * * *" },
	];

	const enabledServers = servers.filter((s) => s.enabled);

	return (
		<form onSubmit={handleSubmit} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
			<h3 className="text-lg font-semibold text-white light:text-slate-900">创建定时任务</h3>
			{error && <div role="alert" className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200 light:text-rose-800">{error}</div>}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white light:text-slate-900/50 tracking-wide">任务名称</label>
				<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例如：清理日志" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white light:text-slate-900 outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white light:text-slate-900/50 tracking-wide">Cron 表达式</label>
				<input value={cronExpression} onChange={(e) => setCron(e.target.value)} required placeholder="0 3 * * *" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white light:text-slate-900 font-mono outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
				<p className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.06] px-3 py-2 text-xs text-cyan-100 light:text-cyan-900">预览：{cronPreview}</p>
				<div className="flex flex-wrap gap-1.5">
					{presetCrons.map((p) => (
						<button key={p.expr} type="button" onClick={() => setCron(p.expr)}
							className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
								cronExpression === p.expr
									? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 light:text-cyan-900"
									: "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.04]"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white light:text-slate-900/50 tracking-wide">命令内容</label>
				<textarea value={command} onChange={(e) => setCommand(e.target.value)} required rows={3} placeholder="df -h" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white light:text-slate-900 font-mono outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 resize-y" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white light:text-slate-900/50 tracking-wide">原因 / 备注</label>
				<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="可选" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white light:text-slate-900 outline-none transition placeholder:text-white/20 focus:border-cyan-400/30" />
			</div>

			{enabledServers.length > 0 && (
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-white light:text-slate-900/50 tracking-wide">目标节点</label>
					<div className="grid gap-1.5 sm:grid-cols-2">
						{enabledServers.map((s) => (
							<label key={s.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
								selectedServerIds.has(s.id) ? "border-cyan-400/20 bg-cyan-400/[0.06] text-white light:text-slate-900" : "border-white/[0.06] bg-white/[0.03] text-slate-300 light:text-slate-700 hover:bg-white/[0.05]"
							}`}>
								<input type="checkbox" checked={selectedServerIds.has(s.id)} onChange={() => toggleServer(s.id)} className="accent-cyan-400" />
								<span>{s.name}</span>
							</label>
						))}
					</div>
				</div>
			)}

			<div className="flex gap-3 pt-2">
				<button type="submit" disabled={submitting} className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
					{submitting ? "创建中…" : "创建任务"}
				</button>
				<button type="button" onClick={onClose} className="rounded-2xl border border-white/10 light:border-slate-200 px-5 py-2 text-sm text-slate-300 light:text-slate-700 hover:bg-white/10 transition">
					取消
				</button>
			</div>
		</form>
	);
}
