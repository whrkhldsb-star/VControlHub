"use client";

import { useId, type ReactNode, type RefObject } from "react";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { Notice } from "@/components/ui-primitives";

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
	/** Attached to the cancel button and focused on open (the safe default for destructive actions). */
	cancelButtonRef?: RefObject<HTMLButtonElement | null>;
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
	cancelButtonRef,
}: ConfirmDialogProps) {
	const titleId = useId();
	return (
		<ModalShell
			size="md" placement="sheet"
			open={open}
			onClose={onCancel}
			{...(ariaLabel ? { label: ariaLabel } : { labelledBy: titleId })}
			initialFocusRef={cancelButtonRef}
			closeOnBackdrop={closeOnBackdrop}
			busy={busy}
			as="section"
		>
				<div className="flex items-start gap-3">
					<span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
					</span>
					<div className="min-w-0 flex-1">
						<h2 id={titleId} className="ui-title-dialog">{title}</h2>
						{description ? <div className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">{description}</div> : null}
					</div>
				</div>
				{error ? <Notice tone="danger" compact className="mt-3">{error}</Notice> : null}
				<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<ActionButton ref={cancelButtonRef} type="button" variant="secondary" onClick={onCancel} disabled={busy}>
						{cancelLabel}
					</ActionButton>
					<ActionButton type="button" variant="danger-solid" onClick={onConfirm} loading={busy}>
						{confirmLabel}
					</ActionButton>
				</div>
		</ModalShell>
	);
}
