import { expect } from "vitest";

/**
 * Assertions for the shared UI system. Touch-target size and dialog placement
 * come from design tokens and data attributes (docs/ui-system.md), not from
 * per-element pixel classes, so tests assert the attributes:
 *
 *   - every <ActionButton>/<ButtonLink> except size="xs" is at least
 *     --touch-target (44px) tall on coarse pointers (`--control-height*`);
 *   - form controls use `--control-height` through the `ui-control` class;
 *   - bottom-sheet dialogs carry `data-motion="sheet"` on the panel.
 */
export function isTouchTarget(element: Element): boolean {
	if (element.hasAttribute("data-action-button")) return element.getAttribute("data-size") !== "xs";
	const className = element.getAttribute("class") ?? "";
	return /(^|\s)ui-control(\s|$)/.test(className) || /(^|\s)!?min-h-(11|12|14)(\s|$)/.test(className) || /(^|\s)!?h-(11|12|14)(\s|$)/.test(className);
}

export function expectTouchTarget(element: Element) {
	expect(isTouchTarget(element), `${element.outerHTML.slice(0, 160)} is not a 44px touch target`).toBe(true);
}

export function expectBottomSheet(panel: Element) {
	expect(panel.closest("[data-modal-panel]") ?? panel).toHaveAttribute("data-motion", "sheet");
}
