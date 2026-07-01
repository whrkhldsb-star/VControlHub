"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { BackupType } from "@/lib/backup/service";
import { formatZhDateTime } from "@/lib/datetime/format";

/* ── Types ────────────────────────────────────────────────── */

type BackupSchedule = {
	id: string;
	name: string;
	cronExpression: string;
	backupType: string;
	note: string | null;
	retentionDays: number | null;
	status: string;
	lastRunAt: string | null;
	nextRunAt: string | null;
	lastResult: string | null;
	runCount: number;
	createdAt: string;
	creator?: { username: string | null; displayName: string | null } | null;
};

/* ── Helpers ──────────────────────────────────────────────── */

function getTypeLabel(t: (k: string) => string, type: BackupType): string {
	const map: Record<BackupType, string> = {
		DATABASE: t("backupsPage.schedule.type.database"),
		FILES: t("backupsPage.schedule.type.files"),
		FULL: t("backupsPage.schedule.type.full"),
	};
	return map[type];
}

function describeCronPreview(expr: string, t: (k: string) => string) {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return t("backupsPage.schedule.cronError.5parts");
	const [min, hour, day, month, dow] = parts;
	if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*") return t("backupsPage.schedule.cronPreview.everyHour");
	if (day === "*" && month === "*" && dow === "*" && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) return t("backupsPage.schedule.cronPreview.everyDay").replace("{hour}", hour!).replace("{min}", min!.padStart(2, "0"));
	if (day === "*" && month === "*" && /^\d+$/.test(dow!) && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) {
		const dowName = t(`backupsPage.schedule.cronPreview.dowName.${dow}`);
		const safeName = dowName.startsWith("backupsPage.") ? t("backupsPage.schedule.cronPreview.dowFallback").replace("{dow}", dow!) : dowName;
		return t("backupsPage.schedule.cronPreview.everyDow").replace("{dowName}", safeName).replace("{hour}", hour!).replace("{min}", min!.padStart(2, "0"));
	}
	return t("backupsPage.schedule.cronPreview.custom");
}

function statusBadgeClass(status: string): string {
	if (status === "ACTIVE") return "border-emerald-400/20 text-emerald-200";
	if (status === "PAUSED") return "border-amber-400/20 text-amber-200";
	return "border-rose-400/20 text-rose-200";
}

function statusLabel(t: (k: string) => string, status: string): string {
	if (status === "ACTIVE") return t("backupsPage.schedule.status.active");
	if (status === "PAUSED") return t("backupsPage.schedule.status.paused");
	return t("backupsPage.schedule.status.disabled");
}

/* ── Form + List Component ────────────────────────────────── */

export function ScheduleBackupForm() {
	const { t } = useI18n();
	const [type, setType] = useState<BackupType>("DATABASE");
	const [name, setName] = useState("");
	const [cronExpression, setCronExpression] = useState("0 3 * * *");
	const [note, setNote] = useState("");
	const [retentionDays, setRetentionDays] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
	const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
	const [loadingList, setLoadingList] = useState(true);

	const cronPreview = useMemo(() => describeCronPreview(cronExpression, t), [cronExpression, t]);

	const loadSchedules = useCallback(async () => {
		try {
			const res = await csrfFetch("/api/backup-schedules", { method: "GET" });
			if (!res.ok) return;
			const data = await res.json();
			setSchedules(data.schedules ?? []);
		} catch {
			// best-effort
		} finally {
			setLoadingList(false);
		}
	}, []);

	useEffect(() => {
		void loadSchedules();
	}, [loadSchedules]);

	const createSchedule = async (event: React.FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		setMessage(null);
		try {
			const body: Record<string, unknown> = {
				name: name.trim() || t("backupsPage.schedule.nameTemplate").replace("{type}", getTypeLabel(t, type)),
				cronExpression,
				backupType: type,
			};
			if (note.trim()) body.note = note.trim();
			if (retentionDays.trim()) {
				const parsed = Number.parseInt(retentionDays, 10);
				if (Number.isFinite(parsed) && parsed > 0) body.retentionDays = parsed;
			}
			const res = await csrfFetch("/api/backup-schedules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || err.summary || t("backupsPage.schedule.failFallback"));
			}
			setMessage({ type: "ok", text: t("backupsPage.schedule.success") });
			setName("");
			setNote("");
			setRetentionDays("");
			await loadSchedules();
		} catch (error) {
			setMessage({ type: "error", text: error instanceof Error ? error.message : t("backupsPage.schedule.failFallback") });
		} finally {
			setSubmitting(false);
		}
	};

	const toggleSchedule = async (id: string) => {
		try {
			await csrfFetch("/api/backup-schedules", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ toggleId: id }),
			});
			await loadSchedules();
		} catch {
			// best-effort
		}
	};

	const deleteSchedule = async (id: string) => {
		if (!window.confirm(t("backupsPage.schedule.deleteConfirm"))) return;
		try {
			await csrfFetch(`/api/backup-schedules/${id}`, { method: "DELETE" });
			await loadSchedules();
		} catch {
			// best-effort
		}
	};

	return (
		<div className="mt-4 space-y-4">
			{/* Create form */}
			<form onSubmit={createSchedule} data-tone="cyan" className="space-y-4 rounded-xl border border-cyan-400/10 p-4">
				<div className="grid gap-3 md:grid-cols-[180px_1fr]">
					<div className="space-y-1.5">
						<label htmlFor="schedule-backup-name" className="block text-xs font-medium text-[var(--text-secondary)]">{t("backupsPage.records.title")}</label>
						<input id="schedule-backup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("backupsPage.schedule.nameTemplate").replace("{type}", getTypeLabel(t, type))} className="block w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
					</div>
					<div className="space-y-1.5">
						<label htmlFor="schedule-backup-type" className="block text-xs font-medium text-[var(--text-secondary)]">{t("common.backupType")}</label>
						<select id="schedule-backup-type" value={type} onChange={(e) => setType(e.target.value as BackupType)} className="block w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
							<option value="DATABASE">{t("common.databaseBackup")}</option>
							<option value="FILES">{t("common.fileBackup")}</option>
							<option value="FULL">{t("common.fullBackup")}</option>
						</select>
					</div>
				</div>
				<div className="grid gap-3 md:grid-cols-[1fr_180px]">
					<div className="space-y-1.5">
						<label htmlFor="schedule-backup-cron" className="block text-xs font-medium text-[var(--text-secondary)]">{t("common.cronExpression")}</label>
						<input id="schedule-backup-cron" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} required placeholder="0 3 * * *" className="block w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]" />
					</div>
					<div className="space-y-1.5">
						<label htmlFor="schedule-backup-retention" className="block text-xs font-medium text-[var(--text-secondary)]">{t("backupsPage.schedule.retentionLabel")}</label>
						<input id="schedule-backup-retention" type="number" min={1} max={3650} value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} placeholder={t("backupsPage.schedule.retentionPlaceholder")} className="block w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
					</div>
				</div>
				<p data-tone="cyan" className="rounded-lg border border-cyan-400/10 px-3 py-2 text-xs text-[var(--text-primary)]">{t("common.preview")}{cronPreview}</p>
				<div className="space-y-1.5">
					<label htmlFor="schedule-backup-note" className="block text-xs font-medium text-[var(--text-secondary)]">{t("backupsPage.schedule.noteLabel")}</label>
					<input id="schedule-backup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("backupsPage.schedule.notePlaceholder")} className="block w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]" />
				</div>
				{retentionDays && (
					<p className="text-xs text-[var(--text-muted)]">{t("backupsPage.schedule.retentionHint")}</p>
				)}
				<button type="submit" disabled={submitting} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
					{submitting ? t("backupsPage.schedule.submitting") : t("backupsPage.schedule.submit")}
				</button>
				{message && <p role="status" className={`text-xs ${message.type === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</p>}
			</form>

			{/* Schedule list */}
			<div className="space-y-2">
				<h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("backupsPage.scheduleList.title")}</h3>
				{loadingList ? (
					<p className="text-xs text-[var(--text-muted)]">…</p>
				) : schedules.length === 0 ? (
					<p className="text-xs text-[var(--text-muted)]">{t("backupsPage.scheduleList.empty")}</p>
				) : (
					<div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
						{schedules.map((s) => (
							<div key={s.id} className="px-4 py-3">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-[var(--text-primary)]">{s.name}</span>
											<span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(s.status)}`}>{statusLabel(t, s.status)}</span>
										</div>
										<div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
											<span className="font-mono">{s.cronExpression}</span>
											<span>{getTypeLabel(t, s.backupType as BackupType)}</span>
											<span>{t("backupsPage.schedule.runCount").replace("{count}", String(s.runCount))}</span>
											{s.retentionDays && <span>{t("backupsPage.schedule.retentionLabel")}: {s.retentionDays}</span>}
										</div>
										<div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
											{s.lastRunAt
												? <span>{t("backupsPage.schedule.lastRun").replace("{time}", formatZhDateTime(s.lastRunAt))}</span>
												: <span>{t("backupsPage.schedule.lastRunNone")}</span>}
											{s.status === "ACTIVE" && s.nextRunAt
												? <span>{t("backupsPage.schedule.nextRun").replace("{time}", formatZhDateTime(s.nextRunAt))}</span>
												: <span>{t("backupsPage.schedule.nextRunPaused")}</span>}
										</div>
										{s.lastResult && (
											<p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{t("backupsPage.schedule.lastResult").replace("{result}", s.lastResult)}</p>
										)}
										{s.note && <p className="mt-1 text-xs text-[var(--text-muted)]">{s.note}</p>}
									</div>
									<div className="flex shrink-0 gap-2">
										<button
											type="button"
											onClick={() => toggleSchedule(s.id)}
											className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border)]/[0.16] hover:text-[var(--text-primary)]"
										>
											{t("backupsPage.schedule.toggle")}
										</button>
										<button
											type="button"
											onClick={() => deleteSchedule(s.id)}
											className="rounded-lg border border-rose-400/20 px-2 py-1 text-xs text-rose-200 transition hover:border-rose-400/40"
										>
											{t("backupsPage.schedule.delete")}
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
