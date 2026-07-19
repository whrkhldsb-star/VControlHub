"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

/**
 * `pendingSourceDelete` confirmation modal — extracted from
 * `quick-services-client.tsx` (TR-036) so the dialog body ships in its
 * own lazy chunk. Renders only when the user clicks "删除" on an
 * app source row.
 */

type PendingSourceDeleteDialogProps = {
	pending: { id: string; displayName: string } | null;
	onCancel: () => void;
	onConfirm: () => void;
};

export function PendingSourceDeleteDialog({
	pending,
	onCancel,
	onConfirm,
}: PendingSourceDeleteDialogProps) {
	const { t } = useI18n();
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: true, onClose: onCancel });
	if (!pending) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={t("qsPage.deleteSourceAria")}
				className="mx-0 w-full max-w-md rounded-t-2xl border border-[var(--danger-border)] bg-[var(--surface-root)] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{t("qsPage.deleteSourceTitle")}</h3>
				<p className="text-sm leading-6 text-[var(--text-secondary)]">
					{t("qsPage.deleteSourceBody").replace("{name}", pending.displayName)}
				</p>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onCancel}
						data-action-button data-variant="secondary" className="min-h-11 !text-xs"
					>
						{t("qsPage.cancel")}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						data-action-button data-variant="danger" className="min-h-11 !text-xs"
					>
						{t("qsPage.confirmDelete")}
					</button>
				</div>
			</div>
		</div>
	);
}
