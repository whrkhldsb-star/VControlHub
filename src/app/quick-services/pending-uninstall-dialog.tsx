"use client";

import { useI18n } from "@/lib/i18n/use-locale";

/**
 * `pendingUninstall` confirmation modal — extracted from
 * `quick-services-client.tsx` (TR-036) so the dialog body ships in
 * its own lazy chunk. Renders only when the user clicks "卸载" on
 * an installed Quick Service.
 */

type PendingUninstallDialogProps = {
	pending: { slug: string; name: string; deleteVolumes: boolean } | null;
	onCancel: () => void;
	onConfirm: () => void;
	onToggleDeleteVolumes: (next: boolean) => void;
};

export function PendingUninstallDialog({
	pending,
	onCancel,
	onConfirm,
	onToggleDeleteVolumes,
}: PendingUninstallDialogProps) {
	const { t } = useI18n();
	if (!pending) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("qsPage.uninstallAria")}
				className="mx-0 w-full max-w-md rounded-t-2xl border border-[var(--danger-border)] bg-[var(--surface-root)] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{t("qsPage.uninstallTitle")}</h3>
				<p className="text-sm leading-6 text-[var(--text-secondary)]">
					{t("qsPage.uninstallBody").replace("{name}", pending.name)}
				</p>
				<label
					data-tone="rose"
					className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]"
				>
					<input
						type="checkbox"
						checked={pending.deleteVolumes}
						onChange={(e) => onToggleDeleteVolumes(e.target.checked)}
						className="mt-1 h-4 w-4 rounded-lg border-[var(--danger-border)] bg-transparent text-[var(--danger)]"
					/>
					<span>
						<span className="block font-medium">{t("qsPage.alsoDeleteData")}</span>
						<span className="mt-1 block text-xs leading-5 text-[var(--danger)]/80">
							{t("qsPage.dataDeleteHint")}
						</span>
					</span>
				</label>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 rounded-lg border border-[var(--border)]/[0.1] px-4 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.04] transition"
					>
						{t("qsPage.cancel")}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="min-h-11 rounded-lg bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] transition"
					>
						{t("qsPage.confirmUninstall")}
					</button>
				</div>
			</div>
		</div>
	);
}
