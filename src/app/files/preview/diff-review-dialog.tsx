"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import type { DiffRow } from "./text-preview-types";

type DiffReviewDialogProps = {
	diffRows: DiffRow[];
	diffSummary: { added: number; removed: number; changed: number };
	saveStatus: string;
	canReloadAfterSave: boolean;
	reloadKind?: "systemd" | "compose";
	reloadUnit: string | undefined;
	onClose: () => void;
	onSave: () => void;
	onSaveAndReload: () => void;
};

export function DiffReviewDialog({
	diffRows,
	diffSummary,
	saveStatus,
	canReloadAfterSave,
	reloadKind,
	reloadUnit,
	onClose,
	onSave,
	onSaveAndReload,
}: DiffReviewDialogProps) {
	const { t } = useI18n();
	const busy = saveStatus === "saving" || saveStatus === "reloading";
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose });
	return (
		<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("textPreview.diffDialog.title")} data-tone="amber" className="rounded-2xl border border-[var(--warning-border)] p-4 shadow-2xl shadow-black/20">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-sm font-semibold text-[var(--warning)]">{t("textPreview.diffDialog.title")}</h3>
					<p className="mt-1 text-xs text-[var(--warning)]/80">
						{t("textPreview.diffDialog.summary").replace("{added}", String(diffSummary.added)).replace("{removed}", String(diffSummary.removed)).replace("{changed}", String(diffSummary.changed))}
					</p>
					<p className="mt-1 text-xs text-[var(--warning)]/70">
						{t("textPreview.diffDialog.note")}
					</p>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)]/70 px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
					>
						{t("textPreview.button.backToEdit")}
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={busy || diffRows.length === 0}
					 data-action-button data-variant="success" className="!px-3 !py-1.5 !text-xs disabled:opacity-50">
						{saveStatus === "saving" ? t("textPreview.button.saving") : t("textPreview.button.confirmSave")}
					</button>
					{canReloadAfterSave ? (
						<button
							type="button"
							onClick={onSaveAndReload}
							disabled={busy || diffRows.length === 0}
							data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs font-medium text-[var(--warning)] disabled:opacity-50"
							title={reloadKind === "systemd"
								? t("textPreview.reloadHint.systemdConfirm").replace("{unit}", reloadUnit ?? "")
								: t("textPreview.reloadHint.dockerConfirm").replace("{unit}", reloadUnit ?? "")}
						>
							{saveStatus === "saving"
								? t("textPreview.button.saving")
								: saveStatus === "reloading"
									? t("textPreview.button.reloading")
									: t("textPreview.button.saveAndReload").replace("{unit}", reloadUnit ?? "")}
						</button>
					) : null}
				</div>
			</div>
			<div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)]/[0.10] bg-[var(--surface)]">
				{diffRows.length === 0 ? (
					<p className="px-3 py-2 text-xs text-[var(--text-secondary)]">{t("textPreview.diffEmpty")}</p>
				) : (
					<ul className="divide-y divide-white/[0.10] light:divide-slate-200">
						{diffRows.slice(0, 80).map((row) => (
							<li key={`${row.line}-${row.kind}`} className="grid gap-1 px-3 py-2 text-xs md:grid-cols-[80px_1fr_1fr]">
								<span className="font-mono text-[var(--text-muted)]">L{row.line} · {row.kind === "added" ? t("textPreview.diffKind.added") : row.kind === "removed" ? t("textPreview.diffKind.removed") : t("textPreview.diffKind.changed")}</span>
								<code className="min-h-5 whitespace-pre-wrap break-all rounded-lg bg-[var(--danger-bg)]/20 px-2 py-1 text-[var(--danger)]">- {row.before}</code>
								<code className="min-h-5 whitespace-pre-wrap break-all rounded-lg bg-[var(--success-bg)] px-2 py-1 text-[var(--success)]">+ {row.after}</code>
							</li>
						))}
						{diffRows.length > 80 ? <li className="px-3 py-2 text-xs text-[var(--text-muted)]">{t("textPreview.diffMore").replace("{count}", String(diffRows.length - 80))}</li> : null}
					</ul>
				)}
			</div>
		</div>
	);
}
