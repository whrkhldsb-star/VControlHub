"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";

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
	if (!pending) return null;
	return (
		<ModalShell
			open
			onClose={onCancel}
			label={t("qsPage.deleteSourceAria")}
			overlayClassName="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
			panelClassName="mx-0 w-full max-w-md rounded-t-2xl border border-[var(--danger-border)] bg-[var(--surface-root)] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
		>
				<h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{t("qsPage.deleteSourceTitle")}</h3>
				<p className="text-sm leading-6 text-[var(--text-secondary)]">
					{t("qsPage.deleteSourceBody", { name: pending.displayName })}
				</p>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<ActionButton variant="secondary"
						onClick={onCancel} className="min-h-11 !text-xs"
					>
						{t("qsPage.cancel")}
					</ActionButton>
					<ActionButton variant="danger"
						onClick={onConfirm} className="min-h-11 !text-xs"
					>
						{t("qsPage.confirmDelete")}
					</ActionButton>
				</div>
		</ModalShell>
	);
}
