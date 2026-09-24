"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * `pendingUninstall` confirmation modal — extracted from
 * `quick-services-client.tsx` (TR-036) so the dialog body ships in
 * its own lazy chunk. Renders only when the user clicks "卸载" on
 * an installed Quick Service.
 *
 * Thin ConfirmDialog wrapper: the destructive-confirm shell (title /
 * cancel / confirm / danger styling) is shared; the only local content
 * is the body line plus the "also delete data" checkbox, passed
 * through ConfirmDialog's `description` slot.
 */

type PendingUninstallDialogProps = {
	pending: { slug: string; name: string; deleteVolumes: boolean } | null;
	supportsDataDeletion: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	onToggleDeleteVolumes: (next: boolean) => void;
};

export function PendingUninstallDialog({
	pending,
	supportsDataDeletion,
	onCancel,
	onConfirm,
	onToggleDeleteVolumes,
}: PendingUninstallDialogProps) {
	const { t } = useI18n();
	return (
		<ConfirmDialog
			open={pending !== null}
			title={t("qsPage.uninstallTitle")}
			description={
				pending ? (
					<>
						<p>{t("qsPage.uninstallBody", { name: pending.name })}</p>
						<label
							data-tone="rose"
							className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]"
						>
							<input
								type="checkbox"
								checked={pending.deleteVolumes}
								disabled={!supportsDataDeletion}
								onChange={(e) => onToggleDeleteVolumes(e.target.checked)}
								className="mt-1 h-4 w-4 rounded-lg border-[var(--danger-border)] bg-transparent text-[var(--danger)]"
							/>
							<span>
								<span className="block font-medium">{t("qsPage.alsoDeleteData")}</span>
								<span className="mt-1 block text-xs leading-5 text-[var(--danger)]/80">
									{t(supportsDataDeletion ? "qsPage.dataDeleteHint" : "qsPage.remoteDataDeleteUnsupported")}
								</span>
							</span>
						</label>
					</>
				) : null
			}
			cancelLabel={t("qsPage.cancel")}
			confirmLabel={t("qsPage.confirmUninstall")}
			onCancel={onCancel}
			onConfirm={onConfirm}
			ariaLabel={t("qsPage.uninstallAria")}
		/>
	);
}
