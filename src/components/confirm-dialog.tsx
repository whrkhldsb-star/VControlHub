"use client";

import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { UI_MODAL_PANEL, UI_OVERLAY } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

type ConfirmDialogProps = {
	open: boolean;
	title: ReactNode;
	description?: ReactNode;
	cancelLabel: ReactNode;
	confirmLabel: ReactNode;
	onCancel: () => void;
	onConfirm: () => void;
	busy?: boolean;
	closeOnBackdrop?: boolean;
	error?: ReactNode;
	ariaLabel?: string;
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
	error,
	ariaLabel,
}: ConfirmDialogProps) {
	return (
		<ModalShell
			open={open}
			onClose={onCancel}
			{...(ariaLabel ? { label: ariaLabel } : { labelledBy: "confirm-dialog-title" })}
			overlayClassName={cn(UI_OVERLAY, "flex items-center justify-center px-4")}
			panelClassName={cn(UI_MODAL_PANEL, "w-full max-w-md border-[var(--danger-border)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]")}
			closeOnBackdrop={closeOnBackdrop}
			busy={busy}
			as="section"
		>
				<h2 id="confirm-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
				{description ? <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{description}</div> : null}
				{error ? <div role="alert" className="mt-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">{error}</div> : null}
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
