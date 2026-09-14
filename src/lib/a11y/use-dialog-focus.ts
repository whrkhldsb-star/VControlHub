"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"textarea:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

const dialogStack: symbol[] = [];
let bodyOverflow = "";

type DialogFocusOptions = {
	open: boolean;
	onClose: () => void;
	initialFocusRef?: RefObject<HTMLElement | null>;
	restoreFocus?: boolean;
	/** When true, Escape must not dismiss (in-flight destructive / submit). */
	closeLocked?: boolean;
};

function getFocusableElements(container: HTMLElement) {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => {
			if (element.matches(':disabled, [type="hidden"]') || element.tabIndex < 0 || element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
			for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
				const style = window.getComputedStyle(parent);
				if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
				if (parent === container) break;
			}
			return true;
		},
	);
}

export function useDialogFocus<TElement extends HTMLElement>({
	open,
	onClose,
	initialFocusRef,
	restoreFocus = true,
	closeLocked = false,
}: DialogFocusOptions) {
	const dialogRef = useRef<TElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	const closeLockedRef = useRef(closeLocked);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		closeLockedRef.current = closeLocked;
	}, [closeLocked]);

	useEffect(() => {
		if (!open) return;
		const stackId = Symbol("dialog");
		if (dialogStack.length === 0) {
			bodyOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
		}
		dialogStack.push(stackId);
		const isTopDialog = () => dialogStack.at(-1) === stackId;

		const activeElement = document.activeElement;
		returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

		const focusTimer = window.setTimeout(() => {
			if (!isTopDialog()) return;
			const dialog = dialogRef.current;
			if (!dialog) return;
			const focusTarget = initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog;
			focusTarget.focus();
		}, 0);

		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isTopDialog()) return;
			const dialog = dialogRef.current;
			if (!dialog) return;

			if (event.key === "Escape") {
				event.preventDefault();
				if (closeLockedRef.current) return;
				onCloseRef.current();
				return;
			}

			if (event.key !== "Tab") return;

			const focusableElements = getFocusableElements(dialog);
			if (focusableElements.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}

			const first = focusableElements[0]!;
			const last = focusableElements[focusableElements.length - 1]!;
			const active = document.activeElement;

			if (!dialog.contains(active)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			} else if (event.shiftKey && (active === first || active === dialog)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		window.addEventListener("keydown", handleKeyDown, true);

		return () => {
			window.clearTimeout(focusTimer);
			window.removeEventListener("keydown", handleKeyDown, true);
			const wasTopDialog = isTopDialog();
			const index = dialogStack.indexOf(stackId);
			if (index >= 0) dialogStack.splice(index, 1);
			if (dialogStack.length === 0) document.body.style.overflow = bodyOverflow;
			if (restoreFocus && wasTopDialog) {
				const returnTarget = returnFocusRef.current;
				returnFocusRef.current = null;
				const previousDialog = dialogStack.at(-1);
				window.setTimeout(() => {
					if (dialogStack.at(-1) === previousDialog && returnTarget?.isConnected) returnTarget.focus();
				}, 0);
			}
		};
	}, [initialFocusRef, open, restoreFocus]);

	return dialogRef;
}
