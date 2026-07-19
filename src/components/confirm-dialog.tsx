"use client";

import type { ReactNode } from "react";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { ActionButton } from "@/components/action-button";
import { UI_MODAL_PANEL, UI_OVERLAY } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

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
			className={cn(UI_OVERLAY, "flex items-center justify-center px-4")}
			role="presentation"
			onClick={closeOnBackdrop ? onCancel : undefined}
		>
			<section
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				onClick={(event) => event.stopPropagation()}
				className={cn(UI_MODAL_PANEL, "w-full max-w-md border-[var(--danger-border)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]")}
			>
				<h2 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
				<div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
					<ActionButton type="button" variant="secondary" onClick={onCancel} disabled={busy} className="min-h-11">
						{cancelLabel}
					</ActionButton>
					<ActionButton type="button" variant="danger-solid" onClick={onConfirm} disabled={busy} className="min-h-11">
						{confirmLabel}
					</ActionButton>
				</div>
			</section>
		</div>
	);
}
