"use client";

/**
 * ModalShell — the one modal primitive.
 *
 * It owns the plumbing every dialog needs (portal, focus trap and Escape via
 * useDialogFocus, backdrop click, role/aria wiring) and the look: overlays and
 * panels come from the DIALOG_* tables below, so restyling every dialog in the
 * app is a change to this file.
 *
 *   size       sm · md (default) · lg · xl · 2xl · full — panel width
 *   placement  center (default) · top (tall, scrolling content) ·
 *              sheet (bottom sheet on phones) · drawer (right-hand panel)
 *   backdrop   default · strong (media viewers, terminals)
 *   padded     false when the content lays out its own header/body/footer
 *   className  extra layout classes merged onto the standard panel
 *              (flex column, max height…) — never colors, borders or radius
 *
 * `overlayClassName` / `panelClassName` replace the standard classes
 * entirely; they are escape hatches for genuinely bespoke surfaces.
 *
 * Prefer <Dialog> (header, body, footer) for content dialogs and
 * <ConfirmDialog> for confirmations; use ModalShell directly for custom
 * layouts such as the command palette.
 */

import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { cn } from "@/lib/ui/cn";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";
export type DialogPlacement = "center" | "top" | "sheet" | "drawer";
export type DialogBackdrop = "default" | "strong";

const DIALOG_WIDTH: Record<DialogSize, string> = {
	sm: "max-w-sm", // 24rem — confirmations, short prompts
	md: "max-w-md", // 28rem — default forms
	lg: "max-w-lg", // 32rem — larger forms
	xl: "max-w-2xl", // 42rem — editors, pickers, lists
	"2xl": "max-w-3xl", // 48rem — detail views, logs
	full: "max-w-5xl", // 64rem — workspaces and previews
};

const DIALOG_BACKDROP: Record<DialogBackdrop, string> = {
	default: "bg-[var(--overlay)] backdrop-blur-[2px]",
	strong: "bg-[var(--overlay-strong)] backdrop-blur-sm",
};

const DIALOG_OVERLAY: Record<DialogPlacement, string> = {
	// Auto margins on the panel centre it while letting tall panels scroll.
	center: "items-start justify-center overflow-y-auto p-4",
	top: "items-start justify-center overflow-y-auto px-3 py-6 sm:px-6 sm:py-12",
	sheet: "items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-4",
	drawer: "justify-end p-0 sm:p-3",
};

const DIALOG_PANEL_PLACEMENT: Record<DialogPlacement, string> = {
	center: "my-auto",
	top: "",
	sheet: "sm:my-auto",
	drawer: "h-full",
};

/** Standard overlay classes (shared with bespoke overlays such as the palette). */
export function dialogOverlayClass(placement: DialogPlacement = "center", backdrop: DialogBackdrop = "default") {
	return cn("fixed inset-0 z-[var(--z-modal)] flex", DIALOG_BACKDROP[backdrop], DIALOG_OVERLAY[placement]);
}

/** Standard panel classes: one surface, border, shadow and padding for every dialog. */
export function dialogPanelClass({
	size = "md",
	placement = "center",
	padded = true,
}: { size?: DialogSize; placement?: DialogPlacement; padded?: boolean } = {}) {
	return cn(
		"w-full border border-[var(--border)] bg-[var(--modal-bg)] text-[var(--text-primary)] shadow-[var(--shadow-lg)]",
		DIALOG_WIDTH[size],
		DIALOG_PANEL_PLACEMENT[placement],
		padded && "p-5",
		padded && placement === "sheet" && "max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]",
	);
}

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
	size?: DialogSize;
	placement?: DialogPlacement;
	backdrop?: DialogBackdrop;
	/** Standard padding (default true). */
	padded?: boolean;
	/** Extra layout classes merged onto the standard panel. */
	className?: string;
	/** Replaces the standard overlay classes entirely. */
	overlayClassName?: string;
	/** Replaces the standard panel classes entirely. */
	panelClassName?: string;
	/** Backdrop click closes the dialog (default true). */
	closeOnBackdrop?: boolean;
	/**
	 * When true, Escape and backdrop must not dismiss — use while a
	 * destructive/submit request is in flight so the dialog cannot race
	 * the mutation (buttons should also be disabled by the caller).
	 */
	busy?: boolean;
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
	size = "md",
	placement = "center",
	backdrop = "default",
	padded = true,
	className,
	overlayClassName,
	panelClassName,
	closeOnBackdrop = true,
	busy = false,
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
		closeLocked: busy,
		...(initialFocusRef ? { initialFocusRef } : {}),
	});

	if (!open || !canUseDom) return null;

	const allowBackdropClose = closeOnBackdrop && !busy;
	const Panel = as;
	return createPortal(
		<div
			data-modal-overlay
			className={overlayClassName ? cn(overlayClassName) : dialogOverlayClass(placement, backdrop)}
			role="presentation"
			onClick={allowBackdropClose ? onClose : undefined}
		>
			<Panel
				data-modal-panel
				data-motion={placement === "sheet" || placement === "drawer" ? placement : undefined}
				ref={dialogRef}
				role={role}
				aria-modal="true"
				aria-busy={busy || undefined}
				{...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
				{...(label ? { "aria-label": label } : {})}
				{...(describedBy ? { "aria-describedby": describedBy } : {})}
				{...(panelProps ?? {})}
				tabIndex={-1}
				className={panelClassName ? cn(panelClassName) : cn(dialogPanelClass({ size, placement, padded }), className)}
				onClick={(event) => event.stopPropagation()}
			>
				{children}
			</Panel>
		</div>,
		document.body,
	);
}
