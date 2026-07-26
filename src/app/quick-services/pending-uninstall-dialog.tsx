"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";

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
		<ModalShell
			open
			onClose={onCancel}
			label={t("qsPage.uninstallAria")}
			overlayClassName="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
			panelClassName="mx-0 w-full max-w-md rounded-t-2xl border border-[var(--danger-border)] bg-[var(--surface-root)] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
		>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{t("qsPage.uninstallTitle")}</h3>
				<p className="text-sm leading-6 text-[var(--text-secondary)]">
					{t("qsPage.uninstallBody", { name: pending.name })}
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
					<ActionButton variant="secondary"
						onClick={onCancel} className="min-h-11 !text-xs"
					>
						{t("qsPage.cancel")}
					</ActionButton>
					<ActionButton variant="danger"
						onClick={onConfirm} className="min-h-11 !text-xs"
					>
						{t("qsPage.confirmUninstall")}
					</ActionButton>
				</div>
		</ModalShell>
	);
}
