"use client";

/**
 * Dialog — the standard content dialog: header (title, description, close),
 * scrollable body and an optional footer for actions. Built on ModalShell,
 * which owns focus trapping, Escape and backdrop handling.
 *
 *   <Dialog open={open} onClose={close} title="Edit rule" size="lg"
 *     footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button>Save</Button></>}>
 *     …form…
 *   </Dialog>
 */
import { useId, type ReactNode, type RefObject } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";
import { X } from "../icons";
import { ModalShell, type DialogPlacement, type DialogSize } from "../modal-shell";
import { IconButton } from "../ui-primitives";

export type DialogProps = {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	/** Action buttons, right-aligned on desktop and stacked on phones. */
	footer?: ReactNode;
	size?: DialogSize;
	/** center (default) or sheet (bottom sheet on phones). */
	placement?: Extract<DialogPlacement, "center" | "sheet" | "top">;
	/** While true, Escape/backdrop/close are disabled (request in flight). */
	busy?: boolean;
	closeOnBackdrop?: boolean;
	initialFocusRef?: RefObject<HTMLElement | null>;
	role?: "dialog" | "alertdialog";
	/** Leading glyph next to the title (e.g. a warning icon). */
	icon?: ReactNode;
	bodyClassName?: string;
	/** Accessible name of the close button (defaults to "Close"). */
	closeLabel?: string;
};

export function Dialog({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	size = "md",
	placement = "center",
	busy = false,
	closeOnBackdrop = true,
	initialFocusRef,
	role,
	icon,
	bodyClassName,
	closeLabel,
}: DialogProps) {
	const { t } = useI18n();
	const titleId = useId();
	const descriptionId = useId();
	return (
		<ModalShell
			open={open}
			onClose={onClose}
			labelledBy={titleId}
			describedBy={description ? descriptionId : undefined}
			busy={busy}
			closeOnBackdrop={closeOnBackdrop}
			initialFocusRef={initialFocusRef}
			role={role}
			size={size}
			placement={placement}
			padded={false}
			className="flex flex-col overflow-hidden"
		>
			<header className="flex items-start gap-3 px-5 pb-3 pt-4">
				{icon ? <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[var(--text-secondary)] [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
				<div className="min-w-0 flex-1">
					<h2 id={titleId} className="text-base font-semibold leading-6 text-[var(--text-primary)]">{title}</h2>
					{description ? <p id={descriptionId} className="mt-0.5 text-[13px] leading-5 text-[var(--text-muted)]">{description}</p> : null}
				</div>
				<IconButton label={closeLabel ?? t("common.close")} onClick={onClose} disabled={busy} className="-mr-1.5 -mt-0.5 h-8 w-8">
					<X size={16} aria-hidden />
				</IconButton>
			</header>
			<div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5", bodyClassName)}>{children}</div>
			{footer ? (
				<footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-5 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
					{footer}
				</footer>
			) : null}
		</ModalShell>
	);
}
