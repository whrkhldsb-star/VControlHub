"use client";

/**
 * ModalShell — shared skeleton for modal dialogs.
 *
 * Owns the repeated plumbing every hand-rolled dialog duplicates:
 *   - conditional render (`open`)
 *   - focus trap + ESC via useDialogFocus
 *   - overlay backdrop click-to-close (opt-out with closeOnBackdrop={false})
 *   - role="dialog" / aria-modal / aria-labelledby wiring
 *   - stopPropagation on the panel
 *
 * Styling stays with the caller: pass the exact overlay/panel class strings
 * (defaults match the most common pattern). Content is fully caller-owned,
 * so migration from a hand-written dialog is a pure-move of the inner JSX.
 *
 * For simple destructive confirmations prefer <ConfirmDialog>. Use ModalShell
 * for content dialogs (forms, previews, log viewers).
 */

import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { cn } from "@/lib/ui/cn";

type ModalShellLabel =
	| {
			/** id of the heading element inside the panel (aria-labelledby). */
			labelledBy: string;
			label?: never;
	  }
	| {
			/** Literal accessible name (aria-label) for dialogs without a heading id. */
			label: string;
			labelledBy?: never;
	  };

type ModalShellProps = ModalShellLabel & {
	open: boolean;
	onClose: () => void;
	/** Optional id for aria-describedby. */
	describedBy?: string;
	children: ReactNode;
	/** Overlay classes. Default matches the project-wide overlay pattern. */
	overlayClassName?: string;
	/** Panel classes. Pass the dialog's existing panel string verbatim. */
	panelClassName?: string;
	/** Backdrop click closes the dialog (default true). */
	closeOnBackdrop?: boolean;
	/** Element focused when the dialog opens (falls back to the panel). */
	initialFocusRef?: RefObject<HTMLElement | null>;
	/** Render the panel as a <section>/<aside> instead of a <div>. */
	as?: "div" | "section" | "aside";
	/** Dialog role. Destructive confirmations may use alertdialog. */
	role?: "dialog" | "alertdialog";
	/** Extra attributes spread onto the panel (e.g. data-tone). */
	panelProps?: Record<string, string>;
};

const subscribeToClient = () => () => {};

export function ModalShell({
	open,
	onClose,
	labelledBy,
	label,
	describedBy,
	children,
	overlayClassName = "fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm",
	panelClassName = "w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl",
	closeOnBackdrop = true,
	initialFocusRef,
	as = "div",
	role = "dialog",
	panelProps,
}: ModalShellProps) {
	const canUseDom = useSyncExternalStore(
		subscribeToClient,
		() => true,
		() => false,
	);
	const dialogRef = useDialogFocus<HTMLDivElement>({
		open,
		onClose,
		...(initialFocusRef ? { initialFocusRef } : {}),
	});

	if (!open || !canUseDom) return null;

	const Panel = as;
	return createPortal(
		<div
			data-modal-overlay
			className={cn(overlayClassName)}
			role="presentation"
			onClick={closeOnBackdrop ? onClose : undefined}
		>
			<Panel
				ref={dialogRef}
				role={role}
				aria-modal="true"
				{...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
				{...(label ? { "aria-label": label } : {})}
				{...(describedBy ? { "aria-describedby": describedBy } : {})}
				{...(panelProps ?? {})}
				tabIndex={-1}
				className={cn(panelClassName)}
				onClick={(event) => event.stopPropagation()}
			>
				{children}
			</Panel>
		</div>,
		document.body,
	);
}
