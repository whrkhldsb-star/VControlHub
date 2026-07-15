/**
 * Real `CreateDownloadForm` component.
 *
 * TR-036: Split out from `downloads-client.tsx` so the new-download
 * form (single + batch modes, server select, target path, file name,
 * category, speed limit) only ships in the client chunk when the
 * user actually opens "+ 新建下载". The page itself ships the task
 * list, filter bar, and global stats; the form chunk arrives on
 * first click.
 *
 * Form state stays owned by the parent (`downloads-client.tsx`) so
 * that the "close + reopen" UX is preserved and so that the chunk
 * boundary is purely about deferring code, not about data flow.
 * The lazy wrapper short-circuits to null when `open === false`,
 * letting the parent drop the `{showForm && (...)}` wrapper.
 */
"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

export interface DownloadFormState {
	url: string;
	serverId: string;
	targetPath: string;
	fileName: string;
	category: string;
	maxSpeedKb: string;
	batchMode: boolean;
	batchText: string;
}

export interface CreateDownloadFormProps {
	open: boolean;
	form: DownloadFormState;
	submitting: boolean;
	batchModeError: string | null;
	servers: Array<{
		id: string;
		name: string;
		host: string;
		storagePath: string;
		storageDriver: "LOCAL" | "SFTP";
		directAccessMode: "PROXY" | "DIRECT" | "AUTO";
		directAccessAvailable: boolean;
		accessTransport: "direct" | "relay";
		accessStatusLabel: string;
		accessDescription: string;
	}>;
	selectedServerId: string;
	onFormChange: (next: DownloadFormState) => void;
	onServerChange: (serverId: string) => void;
	onSubmit: () => void;
}

function getCategories(t: (k: string) => string) {
	return [
		{ value: "", label: t("downloadsPage.form.category.uncategorized"), icon: "📦" },
		{ value: "video", label: t("downloadsPage.form.category.video"), icon: "🎬" },
		{ value: "music", label: t("downloadsPage.form.category.music"), icon: "🎵" },
		{ value: "software", label: t("downloadsPage.form.category.software"), icon: "💿" },
		{ value: "document", label: t("downloadsPage.form.category.document"), icon: "📄" },
		{ value: "image", label: t("downloadsPage.form.category.image"), icon: "🖼️" },
	];
}

function urlTypeLabel(url: string, t: (k: string) => string) {
	if (url.startsWith("magnet:?")) return t("downloadsPage.form.linkType.magnet");
	if (url.startsWith("https://")) return "🔒 HTTPS";
	if (url.startsWith("http://")) return "🔓 HTTP";
	return t("downloadsPage.form.linkType.unknown");
}

export function CreateDownloadForm({
	open,
	form,
	submitting,
	batchModeError,
	servers,
	selectedServerId,
	onFormChange,
	onServerChange,
	onSubmit,
}: CreateDownloadFormProps) {
	const { t } = useI18n();
	if (!open) return null;

	const selectedServer = servers.find((s) => s.id === selectedServerId);

	return (
		<div data-card className="mb-6 space-y-4">
			<h3 className="text-lg font-semibold text-[var(--text-primary)]">{t("downloadsPage.form.title")}</h3>

			{/* Batch mode toggle */}
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => onFormChange({ ...form, batchMode: !form.batchMode })}
					className={`rounded-lg border px-3 py-1.5 text-xs transition ${
						form.batchMode
							? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-secondary)]"
							: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
					}`}
				>
					{t("downloadsPage.form.batchMode")}
				</button>
				{form.batchMode && <span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.form.batchHint")}</span>}
			</div>

			{form.batchMode ? (
				<div className="space-y-1.5">
					<label
						htmlFor="download-batch-links"
						className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
					>
						{t("downloadsPage.form.linkLabel.batch")}
					</label>
					<textarea
						id="download-batch-links"
						value={form.batchText}
						onChange={(e) => onFormChange({ ...form, batchText: e.target.value })}
						rows={6}
						placeholder={"https://example.com/file1.zip\nhttps://example.com/file2.zip\nhttps://example.com/file3.iso"}
						className={UI_INPUT}
					/>
					<p className="text-[11px] text-[var(--text-muted)]">
						{t("downloadsPage.form.batchNotice")}
					</p>
					{batchModeError && <p className="text-[11px] text-[var(--danger)]">{batchModeError}</p>}
				</div>
			) : (
				<div className="space-y-1.5">
					<label
						htmlFor="download-url"
						className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
					>
						{t("downloadsPage.form.linkLabel.single")}
					</label>
					<input
						id="download-url"
						type="url"
						value={form.url}
						onChange={(e) => onFormChange({ ...form, url: e.target.value })}
						placeholder={t("downloadsPage.form.linkPlaceholder")}
						className={UI_INPUT}
					/>
					{form.url && <p className="text-[11px] text-[var(--text-muted)]">{urlTypeLabel(form.url, t)}</p>}
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="downloadServer">{t("downloadsPage.form.targetVps")}</label>
					<select
						id="downloadServer"
						value={form.serverId}
						onChange={(e) => onServerChange(e.target.value)}
						className={UI_INPUT}
					>
						{servers.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name} ({s.host})
							</option>
						))}
					</select>
					{selectedServer && (
						<div
							className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${
								selectedServer.accessTransport === "direct"
									? "border-[var(--success-border)] bg-[var(--success)]/[0.10] text-[var(--success)]"
									: "border-[var(--warning-border)] bg-[var(--warning)]/[0.10] text-[var(--warning)]"
							}`}
						>
							<div className="font-medium">{selectedServer.accessStatusLabel}</div>
							<div className="mt-0.5 opacity-80">{selectedServer.accessDescription}</div>
						</div>
					)}
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="downloadTargetPath">{t("downloadsPage.form.savePath")}</label>
					<input
						id="downloadTargetPath"
						value={form.targetPath}
						onChange={(e) => onFormChange({ ...form, targetPath: e.target.value })}
						placeholder="/root/downloads"
						className={UI_INPUT}
					/>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-3">
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="downloadFileName">{t("common.filenameOptional")}</label>
					<input
						id="downloadFileName"
						value={form.fileName}
						onChange={(e) => onFormChange({ ...form, fileName: e.target.value })}
						placeholder={t("downloadsPage.form.savePathPlaceholder")}
						className={UI_INPUT}
					/>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="downloadCategory">{t("downloadsPage.form.category")}</label>
					<select
						id="downloadCategory"
						value={form.category}
						onChange={(e) => onFormChange({ ...form, category: e.target.value })}
						className={UI_INPUT}
					>
						{getCategories(t).map((c) => (
							<option key={c.value} value={c.value}>
								{c.icon} {c.label}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide" htmlFor="downloadMaxSpeed">{t("downloadsPage.form.speedLimit")}</label>
					<input
						id="downloadMaxSpeed"
						value={form.maxSpeedKb}
						onChange={(e) => onFormChange({ ...form, maxSpeedKb: e.target.value })}
						type="number"
						placeholder={t("downloadsPage.form.speedLimitPlaceholder")}
						className={UI_INPUT}
					/>
				</div>
			</div>

			{form.url?.startsWith("magnet:") && (
				<div
					data-tone="amber"
					className="rounded-xl border border-[var(--warning-border)] px-4 py-3 text-xs text-[var(--warning)]/70"
				>
					{t("downloadsPage.form.magnetNotice")}
				</div>
			)}

			<div
				data-tone="cyan"
				className="rounded-xl border border-[var(--color-action-border)]/15 px-4 py-3 text-xs leading-5 text-[var(--text-primary)]"
			>
				<p className="font-medium">
					{t("downloadsPage.form.postSubmit")}
				</p>
				<p className="mt-1 text-[var(--text-primary)]/70">
					{t("downloadsPage.form.transportInfo")}
				</p>
			</div>

			<div className="flex gap-3 pt-2">
				<button
					type="button"
					onClick={onSubmit}
					disabled={submitting || Boolean(batchModeError) || !form.serverId}
					data-action-button data-variant="primary" className="px-5 text-sm disabled:opacity-60"
				>
					{submitting ? t("downloadsPage.form.submitting") : t("downloadsPage.form.submit")}
				</button>
			</div>
		</div>
	);
}
