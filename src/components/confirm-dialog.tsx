"use client";

import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
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
	return (
		<ModalShell
			open={open}
			onClose={onCancel}
			labelledBy="confirm-dialog-title"
			overlayClassName={cn(UI_OVERLAY, "flex items-center justify-center px-4")}
			panelClassName={cn(UI_MODAL_PANEL, "w-full max-w-md border-[var(--danger-border)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]")}
			closeOnBackdrop={closeOnBackdrop}
			as="section"
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
		</ModalShell>
	);
}
