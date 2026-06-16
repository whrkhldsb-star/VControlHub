"use client";

import { useI18n } from "@/lib/i18n/use-locale";

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
		<div
			className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
			onClick={onCancel}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("qsPage.deleteSourceAria")}
				className="mx-0 w-full max-w-md rounded-t-2xl border border-rose-400/20 bg-[#0c0f1a] p-6 shadow-2xl sm:mx-4 sm:rounded-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold text-white mb-2">{t("qsPage.deleteSourceTitle")}</h3>
				<p className="text-sm leading-6 text-slate-300">
					{t("qsPage.deleteSourceBody").replace("{name}", pending.displayName)}
				</p>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition"
					>
						{t("qsPage.cancel")}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="min-h-11 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition"
					>
						{t("qsPage.confirmDelete")}
					</button>
				</div>
			</div>
		</div>
	);
}
