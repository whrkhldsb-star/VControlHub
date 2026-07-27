"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { formatBytes } from "@/lib/format/bytes";

import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconButton, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { getErrorMessage } from "@/lib/http/error-message";
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

type DeleteTarget =
	| { kind: "schedule"; id: string; name: string }
	| { kind: "record"; id: string }
	| null;

const PRESET_OPTIONS = [
	"nginx-config",
	"mysql",
	"postgres",
	"docker-volumes",
	"website-files",
	"custom",
] as const;

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
	const [creating, setCreating] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [manualPaths, setManualPaths] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
	const [deleting, setDeleting] = useState(false);

	// Create form state
	const [createForm, setCreateForm] = useState({
		name: "",
		cronExpression: "0 3 * * *",
		backupType: "nginx-config",
		paths: "",
		retentionDays: "7",
	});

	const fetchAbortRef = useRef<AbortController | null>(null);
	const fetchAll = useCallback(async () => {
		fetchAbortRef.current?.abort();
		const controller = new AbortController();
		fetchAbortRef.current = controller;
		try {
			const [schedRes, recRes] = await Promise.all([
				fetch(`/api/servers/${serverId}/vps-backup/schedules`, { signal: controller.signal }),
				fetch(`/api/servers/${serverId}/vps-backup/records`, { signal: controller.signal }),
			]);
			if (!schedRes.ok || !recRes.ok) throw new Error(t("vpsBackup.error.fetch"));
			const [schedData, recData] = await Promise.all([
				schedRes.json(),
				recRes.json(),
			]);
			setSchedules(schedData.schedules ?? []);
			setRecords(recData.records ?? []);
		} catch (err) {
			if (controller.signal.aborted) return;
			setError(getErrorMessage(err, t("vpsBackup.error.unknown")));
		} finally {
			if (!controller.signal.aborted) setLoading(false);
		}
		}, [serverId, t]);

	useEffect(() => {
		// Initial data fetch — setState happens inside async callback, not synchronously
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void fetchAll();
		return () => {
			fetchAbortRef.current?.abort();
		};
	}, [fetchAll]);

	const handleTrigger = async (backupType: string) => {
		setTriggering(backupType);
		setError(null);
		try {
			const res = await csrfFetch<Response>(`/api/servers/${serverId}/vps-backup/records`, {
				method: "POST",
				body: JSON.stringify({
					backupType,
					...(backupType === "custom"
						? { paths: manualPaths.split("\n").map((p) => p.trim()).filter(Boolean) }
						: {}),
				}),
				raw: true,
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setError(data.error ?? t("vpsBackup.error.trigger"));
			} else {
				await fetchAll();
			}
		} catch (err) {
			setError(getErrorMessage(err, t("vpsBackup.error.trigger")));
		} finally {
			setTriggering(null);
		}
	};

	const handleCreate = async () => {
		if (creating) return;
		setCreating(true);
		setError(null);
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
				setError(data.error ?? t("vpsBackup.error.create"));
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
			setError(getErrorMessage(err, t("vpsBackup.error.create")));
		} finally {
			setCreating(false);
		}
	};

	const handleDeleteSchedule = async (scheduleId: string) => {
		setError(null);
		try {
			await csrfFetch(`/api/servers/${serverId}/vps-backup/schedules/${scheduleId}`, {
				method: "DELETE",
			});
			await fetchAll();
			return true;
		} catch (err) {
			setError(getErrorMessage(err, t("vpsBackup.error.delete")));
			return false;
		}
	};

	const handleDeleteRecord = async (recordId: string) => {
		setError(null);
		try {
			await csrfFetch(`/api/servers/${serverId}/vps-backup/records/${recordId}`, {
				method: "DELETE",
			});
			await fetchAll();
			return true;
		} catch (err) {
			setError(getErrorMessage(err, t("vpsBackup.error.delete")));
			return false;
		}
	};

	const confirmDelete = async () => {
		if (!deleteTarget || deleting) return;
		setDeleting(true);
		const deleted = deleteTarget.kind === "schedule"
			? await handleDeleteSchedule(deleteTarget.id)
			: await handleDeleteRecord(deleteTarget.id);
		if (deleted) setDeleteTarget(null);
		setDeleting(false);
	};

	const presetLabel = (type: string) => {
		const key = `vpsBackup.preset.${type}`;
		const label = t(key);
		return label === key ? type : label;
	};

	if (loading) {
		return (
			<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
				<div className="text-sm text-[var(--text-muted)]">
					{t("vpsBackup.loading")}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{error ? <Notice tone="danger" compact action={{ label: t("common.retry"), onClick: () => { setError(null); void fetchAll(); } }} onDismiss={() => setError(null)} dismissLabel={t("common.close")}>{error}</Notice> : null}

			{/* Manual trigger */}
			<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
				<div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsBackup.manualTrigger")}
				</div>
				<div className="mb-2">
					<textarea
						className={`${UI_INPUT} min-h-[64px] w-full text-xs`}
						placeholder={t("vpsBackup.pathsPlaceholder")}
						aria-label={t("vpsBackup.pathsPlaceholder")}
						value={manualPaths}
						onChange={(e) => setManualPaths(e.target.value)}
					/>
					<p className="mt-1 text-[11px] text-[var(--text-muted)]">{t("vpsBackup.manualCustomPathsHint")}</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{PRESET_OPTIONS.map((preset) => (
						<ActionButton variant="secondary"
							key={preset}
							disabled={triggering !== null}
							onClick={() => handleTrigger(preset)}
						
							className="!px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
						>
							{triggering === preset ? (
								<span className="animate-pulse">⏳ {presetLabel(preset)}</span>
							) : (
								`▶ ${presetLabel(preset)}`
							)}
						</ActionButton>
					))}
				</div>
			</div>

			{/* Schedules */}
			<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
				<div className="mb-2 flex items-center justify-between">
					<div className="text-sm font-medium text-[var(--text-secondary)]">
						{t("vpsBackup.schedules")}
						<span className="ml-1.5 text-xs text-[var(--text-muted)]">({schedules.length})</span>
					</div>
					{canManage ? (
						<ActionButton variant="outline"
							onClick={() => setShowCreate(!showCreate)}
							aria-label={showCreate ? t("common.close") : t("vpsBackup.addSchedule")}
						
							className="!px-2.5 !py-1 !text-xs"
						>
							{showCreate ? "✕" : `+ ${t("vpsBackup.addSchedule")}`}
						</ActionButton>
					) : null}
				</div>

				{showCreate ? (
					<div className="mb-3 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
						<input
							type="text"
							placeholder={t("vpsBackup.scheduleName")}
							aria-label={t("vpsBackup.scheduleName")}
							value={createForm.name}
							onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
							data-input
							className={UI_INPUT}
						/>
						<div className="grid grid-cols-2 gap-2">
							<select
								value={createForm.backupType}
								aria-label={t("vpsBackup.backupType")}
								onChange={(e) => setCreateForm({ ...createForm, backupType: e.target.value })}
								data-input
								className={UI_INPUT}
							>
								{PRESET_OPTIONS.map((p) => (
									<option key={p} value={p}>{presetLabel(p)}</option>
								))}
							</select>
							<input
								type="text"
								placeholder="0 3 * * *"
								aria-label={t("vpsBackup.cronExpression")}
								value={createForm.cronExpression}
								onChange={(e) => setCreateForm({ ...createForm, cronExpression: e.target.value })}
								data-input
								className={UI_INPUT}
							/>
						</div>
						<textarea
							placeholder={t("vpsBackup.pathsPlaceholder")}
							aria-label={t("vpsBackup.pathsPlaceholder")}
							value={createForm.paths}
							onChange={(e) => setCreateForm({ ...createForm, paths: e.target.value })}
							rows={2}
							data-input
							className={UI_INPUT}
						/>
						<div className="flex items-center gap-2">
							<input
								type="number"
								min={1}
								max={365}
								placeholder={t("vpsBackup.retentionDays")}
								aria-label={t("vpsBackup.retentionDays")}
								value={createForm.retentionDays}
								onChange={(e) => setCreateForm({ ...createForm, retentionDays: e.target.value })}
								data-input className={`w-24 ${UI_INPUT}`}
							/>
							<ActionButton
								type="button"
								onClick={handleCreate}
								disabled={!createForm.name.trim() || creating}
								className="px-4 py-1.5 text-sm"
							>
								{creating ? t("common.submitting") : t("vpsBackup.create")}
							</ActionButton>
						</div>
					</div>
				) : null}

				{schedules.length === 0 ? (
					<div className="space-y-2 py-2">
						<div className="text-xs text-[var(--text-muted)]">
							{t("vpsBackup.noSchedules")}
						</div>
						<p className="text-xs text-[var(--text-secondary)]">
							{t("vpsBackup.emptyHint")}
						</p>
						{canManage ? (
							<div className="flex flex-wrap gap-2">
								<ActionButton variant="primary"
									onClick={() => {
										setCreateForm({
											name: t("vpsBackup.quick.nginxName"),
											cronExpression: "0 3 * * *",
											backupType: "nginx-config",
											paths: "",
											retentionDays: "7",
										});
										setShowCreate(true);
									}}
								
									className="!px-3 !py-1.5 !text-xs"
								>
									{t("vpsBackup.quick.nginx")}
								</ActionButton>
								<ActionButton variant="secondary"
									onClick={() => {
										setCreateForm({
											name: t("vpsBackup.quick.websiteName"),
											cronExpression: "0 4 * * *",
											backupType: "website-files",
											paths: "",
											retentionDays: "7",
										});
										setShowCreate(true);
									}}
								
									className="!px-3 !py-1.5 !text-xs"
								>
									{t("vpsBackup.quick.website")}
								</ActionButton>
								<ActionButton variant="outline"
									onClick={() => setShowCreate(true)}
								
									className="!px-3 !py-1.5 !text-xs"
								>
									{t("vpsBackup.addSchedule")}
								</ActionButton>
							</div>
						) : null}
					</div>
				) : (
					<div className="space-y-1.5">
						{schedules.map((s) => (
							<div
								key={s.id}
								className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
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
									<IconButton label={t("vpsBackup.deleteSchedule", { name: s.name })} tone="danger" onClick={() => setDeleteTarget({ kind: "schedule", id: s.id, name: s.name })} className="ml-2 h-8 w-8 shrink-0 text-xs">✕</IconButton>
								) : null}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Records */}
			<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
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
								className="flex items-start justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm text-[var(--text-primary)]">
											{presetLabel(r.backupType)}
										</span>
										<span
											className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
												r.status === "COMPLETED"
													? "bg-[var(--success-bg)] text-[var(--success)]"
													: r.status === "FAILED"
														? "bg-[var(--danger-bg)] text-[var(--danger)]"
														: "bg-[var(--warning-bg)] text-[var(--warning)]"
											}`}
										>
											{r.status}
										</span>
									</div>
									<div className="mt-0.5 text-xs text-[var(--text-muted)]">
										{new Date(r.createdAt).toLocaleString(toDateLocale(locale))}
										{" · "}
										{formatBytes(r.fileSize)}
										{" · "}
										{formatDuration(r.durationMs)}
										{r.offsiteKey ? " · ☁️" : ""}
									</div>
									{r.errorMessage ? (
										<div className="mt-1 truncate text-xs text-[var(--danger)]/80">
											{r.errorMessage}
										</div>
									) : null}
								</div>
								<div className="ml-2 flex shrink-0 items-center gap-1.5">
									{r.status === "COMPLETED" && r.localPath ? (
										<a
											href={`/api/servers/${serverId}/vps-backup/records/${r.id}/download`}
											aria-label={t("vpsBackup.downloadRecord")}
											className="rounded text-xs text-[var(--color-action)]/80 transition-colors hover:text-[var(--color-action)]"
										>
											⬇
										</a>
									) : null}
									{canManage ? (
										<IconButton label={t("vpsBackup.deleteRecord")} tone="danger" onClick={() => setDeleteTarget({ kind: "record", id: r.id })} className="h-8 w-8 text-xs">✕</IconButton>
									) : null}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
			<ConfirmDialog
				open={deleteTarget !== null}
				title={deleteTarget?.kind === "schedule" ? t("vpsBackup.deleteScheduleTitle") : t("vpsBackup.deleteRecord")}
				description={deleteTarget?.kind === "schedule" ? t("vpsBackup.deleteScheduleConfirm", { name: deleteTarget.name }) : t("vpsBackup.deleteRecord")}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("vpsBackup.confirmDelete")}
				busy={deleting}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={() => void confirmDelete()}
				closeOnBackdrop={false}
			/>
		</div>
	);
}
