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

type DialogFocusOptions = {
	open: boolean;
	onClose: () => void;
	initialFocusRef?: RefObject<HTMLElement | null>;
	restoreFocus?: boolean;
};

function getFocusableElements(container: HTMLElement) {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true" && element.tabIndex !== -1,
	);
}

export function useDialogFocus<TElement extends HTMLElement>({ open, onClose, initialFocusRef, restoreFocus = true }: DialogFocusOptions) {
	const dialogRef = useRef<TElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) return;

		const activeElement = document.activeElement;
		returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;

		const focusTimer = window.setTimeout(() => {
			const dialog = dialogRef.current;
			if (!dialog) return;
			const focusTarget = initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog;
			focusTarget.focus();
		}, 0);

		const handleKeyDown = (event: KeyboardEvent) => {
			const dialog = dialogRef.current;
			if (!dialog) return;

			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}

			if (event.key !== "Tab") return;

			const focusableElements = getFocusableElements(dialog);
			if (focusableElements.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}

			const first = focusableElements[0];
			const last = focusableElements[focusableElements.length - 1];
			const active = document.activeElement;

			if (event.shiftKey && active === first) {
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
			if (restoreFocus) {
				const returnTarget = returnFocusRef.current;
				returnFocusRef.current = null;
				window.setTimeout(() => returnTarget?.focus(), 0);
			}
		};
	}, [initialFocusRef, onClose, open, restoreFocus]);

	return dialogRef;
}
