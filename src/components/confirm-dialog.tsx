"use client";

import type { ReactNode } from "react";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type ConfirmDialogProps = {
	open: boolean;
	title: ReactNode;
	description: ReactNode;
	cancelLabel: ReactNode;
	confirmLabel: ReactNode;
	onCancel: () => void;
	onConfirm: () => void;
	busy?: boolean;
	closeOnBackdrop?: boolean;
};

export function ConfirmDialog({
	open,
	title,
	description,
	cancelLabel,
	confirmLabel,
	onCancel,
	onConfirm,
	busy = false,
	closeOnBackdrop = true,
}: ConfirmDialogProps) {
	const dialogRef = useDialogFocus<HTMLDivElement>({ open, onClose: onCancel });
	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm"
			role="presentation"
			onClick={closeOnBackdrop ? onCancel : undefined}
		>
			<section
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				onClick={(event) => event.stopPropagation()}
				className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]"
			>
				<h2 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
				<div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<button type="button" onClick={onCancel} disabled={busy} data-action-button data-variant="secondary" className="min-h-11 !px-4 !py-2 !text-sm disabled:opacity-50">{cancelLabel}</button>
					<button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:opacity-50">{confirmLabel}</button>
				</div>
			</section>
		</div>
	);
}
