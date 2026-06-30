"use client";

import { useCallback, useEffect, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type BackupSchedule = {
	id: string;
	name: string;
	cronExpression: string;
	backupType: string;
	status: string;
	retentionDays: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
};

type BackupRecord = {
	id: string;
	backupType: string;
	status: string;
	fileSize: string | null;
	localPath: string | null;
	offsiteKey: string | null;
	errorMessage: string | null;
	createdAt: string;
	durationMs: string | null;
};

const PRESET_LABELS: Record<string, { zh: string; en: string }> = {
	"nginx-config": { zh: "Nginx 配置", en: "Nginx Config" },
	"mysql-database": { zh: "MySQL 数据库", en: "MySQL Database" },
	"postgres-database": { zh: "PostgreSQL 数据库", en: "PostgreSQL Database" },
	"docker-volumes": { zh: "Docker Volumes", en: "Docker Volumes" },
	"website-files": { zh: "网站文件", en: "Website Files" },
	custom: { zh: "自定义路径", en: "Custom Paths" },
};

const PRESET_OPTIONS = Object.keys(PRESET_LABELS);

function formatBytes(bytes: string | null): string {
	if (!bytes) return "—";
	const n = Number(bytes);
	if (isNaN(n)) return bytes;
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: string | null): string {
	if (!ms) return "—";
	const n = Number(ms);
	if (isNaN(n)) return ms;
	if (n < 1000) return `${n}ms`;
	if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
	return `${(n / 60_000).toFixed(1)}min`;
}

export function VpsBackupSection({
	serverId,
	canManage,
}: {
	serverId: string;
	canManage: boolean;
}) {
	const { t, locale } = useI18n();
	const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
	const [records, setRecords] = useState<BackupRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [triggering, setTriggering] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);

	// Create form state
	const [createForm, setCreateForm] = useState({
		name: "",
		cronExpression: "0 3 * * *",
		backupType: "nginx-config",
		paths: "",
		retentionDays: "7",
	});

	const fetchAll = useCallback(async () => {
		try {
			const [schedRes, recRes] = await Promise.all([
				fetch(`/api/servers/${serverId}/vps-backup/schedules`),
				fetch(`/api/servers/${serverId}/vps-backup/records`),
			]);
			if (!schedRes.ok || !recRes.ok) throw new Error("Failed to fetch");
			const [schedData, recData] = await Promise.all([
				schedRes.json(),
				recRes.json(),
			]);
			setSchedules(schedData.schedules ?? []);
			setRecords(recData.records ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, [serverId]);

	useEffect(() => {
		// Initial data fetch — setState happens inside async callback, not synchronously
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void fetchAll();
	}, [fetchAll]);

	const handleTrigger = async (backupType: string) => {
		setTriggering(backupType);
		try {
			const res = await csrfFetch<Response>(`/api/servers/${serverId}/vps-backup/records`, {
				method: "POST",
				body: JSON.stringify({ backupType }),
				raw: true,
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setError(data.error ?? "Trigger failed");
			} else {
				await fetchAll();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Trigger failed");
		} finally {
			setTriggering(null);
		}
	};

	const handleCreate = async () => {
		try {
			const res = await csrfFetch<Response>(`/api/servers/${serverId}/vps-backup/schedules`, {
				method: "POST",
				body: JSON.stringify({
					name: createForm.name,
					cronExpression: createForm.cronExpression,
					backupType: createForm.backupType,
					paths: createForm.paths ? createForm.paths.split("\n").filter(Boolean) : undefined,
					retentionDays: createForm.retentionDays
						? parseInt(createForm.retentionDays)
						: undefined,
				}),
				raw: true,
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setError(data.error ?? "Create failed");
			} else {
				setShowCreate(false);
				setCreateForm({
					name: "",
					cronExpression: "0 3 * * *",
					backupType: "nginx-config",
					paths: "",
					retentionDays: "7",
				});
				await fetchAll();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Create failed");
		}
	};

	const handleDeleteSchedule = async (scheduleId: string) => {
		try {
			await csrfFetch(`/api/servers/${serverId}/vps-backup/schedules/${scheduleId}`, {
				method: "DELETE",
			});
			await fetchAll();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
		}
	};

	const handleDeleteRecord = async (recordId: string) => {
		try {
			await csrfFetch(`/api/servers/${serverId}/vps-backup/records/${recordId}`, {
				method: "DELETE",
			});
			await fetchAll();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Delete failed");
		}
	};

	const presetLabel = (type: string) =>
		PRESET_LABELS[type]?.[locale] ?? type;

	if (loading) {
		return (
			<div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-3">
				<div className="text-sm text-[var(--text-muted)]">
					{t("vpsBackup.loading")}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{error ? (
				<div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
					{error}
					<button
						type="button"
						className="ml-2 text-red-200 underline"
						onClick={() => setError(null)}
					>
						✕
					</button>
				</div>
			) : null}

			{/* Manual trigger */}
			<div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-3">
				<div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsBackup.manualTrigger")}
				</div>
				<div className="flex flex-wrap gap-2">
					{PRESET_OPTIONS.map((preset) => (
						<button
							key={preset}
							type="button"
							disabled={triggering !== null}
							onClick={() => handleTrigger(preset)}
							className="rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{triggering === preset ? (
								<span className="animate-pulse">⏳ {presetLabel(preset)}</span>
							) : (
								`▶ ${presetLabel(preset)}`
							)}
						</button>
					))}
				</div>
			</div>

			{/* Schedules */}
			<div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-3">
				<div className="mb-2 flex items-center justify-between">
					<div className="text-sm font-medium text-[var(--text-secondary)]">
						{t("vpsBackup.schedules")}
						<span className="ml-1.5 text-xs text-[var(--text-muted)]">({schedules.length})</span>
					</div>
					{canManage ? (
						<button
							type="button"
							onClick={() => setShowCreate(!showCreate)}
							className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-200 transition-colors hover:bg-cyan-400/20"
						>
							{showCreate ? "✕" : `+ ${t("vpsBackup.addSchedule")}`}
						</button>
					) : null}
				</div>

				{showCreate ? (
					<div className="mb-3 space-y-2 rounded-lg border border-[var(--border)] bg-white/[0.03] p-3">
						<input
							type="text"
							placeholder={t("vpsBackup.scheduleName")}
							value={createForm.name}
							onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
							className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
						/>
						<div className="grid grid-cols-2 gap-2">
							<select
								value={createForm.backupType}
								onChange={(e) => setCreateForm({ ...createForm, backupType: e.target.value })}
								className="rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)]"
							>
								{PRESET_OPTIONS.map((p) => (
									<option key={p} value={p}>{presetLabel(p)}</option>
								))}
							</select>
							<input
								type="text"
								placeholder="0 3 * * *"
								value={createForm.cronExpression}
								onChange={(e) => setCreateForm({ ...createForm, cronExpression: e.target.value })}
								className="rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
							/>
						</div>
						<textarea
							placeholder={t("vpsBackup.pathsPlaceholder")}
							value={createForm.paths}
							onChange={(e) => setCreateForm({ ...createForm, paths: e.target.value })}
							rows={2}
							className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
						/>
						<div className="flex items-center gap-2">
							<input
								type="number"
								min={1}
								max={365}
								placeholder={t("vpsBackup.retentionDays")}
								value={createForm.retentionDays}
								onChange={(e) => setCreateForm({ ...createForm, retentionDays: e.target.value })}
								className="w-24 rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-1.5 text-sm text-[var(--text-primary)]"
							/>
							<button
								type="button"
								onClick={handleCreate}
								disabled={!createForm.name.trim()}
								className="rounded-lg bg-cyan-500/80 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{t("vpsBackup.create")}
							</button>
						</div>
					</div>
				) : null}

				{schedules.length === 0 ? (
					<div className="py-2 text-xs text-[var(--text-muted)]">
						{t("vpsBackup.noSchedules")}
					</div>
				) : (
					<div className="space-y-1.5">
						{schedules.map((s) => (
							<div
								key={s.id}
								className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2"
							>
								<div className="min-w-0">
									<div className="truncate text-sm text-[var(--text-primary)]">{s.name}</div>
									<div className="text-xs text-[var(--text-muted)]">
										{presetLabel(s.backupType)} · {s.cronExpression} ·{" "}
										{s.status === "ACTIVE" ? "✅" : "⏸"} ·{" "}
										{t("vpsBackup.retention")}: {s.retentionDays}d
									</div>
								</div>
								{canManage ? (
									<button
										type="button"
										onClick={() => handleDeleteSchedule(s.id)}
										className="ml-2 shrink-0 text-xs text-red-400/70 transition-colors hover:text-red-400"
									>
										✕
									</button>
								) : null}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Records */}
			<div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-3">
				<div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsBackup.records")}
					<span className="ml-1.5 text-xs text-[var(--text-muted)]">({records.length})</span>
				</div>
				{records.length === 0 ? (
					<div className="py-2 text-xs text-[var(--text-muted)]">
						{t("vpsBackup.noRecords")}
					</div>
				) : (
					<div className="max-h-64 space-y-1.5 overflow-y-auto">
						{records.map((r) => (
							<div
								key={r.id}
								className="flex items-start justify-between rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm text-[var(--text-primary)]">
											{presetLabel(r.backupType)}
										</span>
										<span
											className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
												r.status === "COMPLETED"
													? "bg-green-400/15 text-green-300"
													: r.status === "FAILED"
														? "bg-red-400/15 text-red-300"
														: "bg-amber-400/15 text-amber-300"
											}`}
										>
											{r.status}
										</span>
									</div>
									<div className="mt-0.5 text-xs text-[var(--text-muted)]">
										{new Date(r.createdAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}
										{" · "}
										{formatBytes(r.fileSize)}
										{" · "}
										{formatDuration(r.durationMs)}
										{r.offsiteKey ? " · ☁️" : ""}
									</div>
									{r.errorMessage ? (
										<div className="mt-1 truncate text-xs text-red-300/80">
											{r.errorMessage}
										</div>
									) : null}
								</div>
								<div className="ml-2 flex shrink-0 items-center gap-1.5">
									{r.status === "COMPLETED" && r.localPath ? (
										<a
											href={`/api/servers/${serverId}/vps-backup/records/${r.id}/download`}
											className="rounded text-xs text-cyan-300/80 transition-colors hover:text-cyan-300"
										>
											⬇
										</a>
									) : null}
									{canManage ? (
										<button
											type="button"
											onClick={() => handleDeleteRecord(r.id)}
											className="text-xs text-red-400/60 transition-colors hover:text-red-400"
										>
											✕
										</button>
									) : null}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
