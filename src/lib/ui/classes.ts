/**
 * Shared Tailwind class fragments for recurring UI patterns.
 *
 * Prefer ActionButton / page-shell / ui-primitives components when a full
 * interactive control is needed. Use these strings only for one-off markup
 * that cannot (yet) adopt a component without a larger rewrite.
 *
 * Keep fragments short and token-based — never hard-code white/black opacity.
 */

/** Solid primary CTA — prefer <ActionButton> when possible. */
export const UI_BTN_PRIMARY =
	"inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";

/** Quiet secondary / cancel control. */
export const UI_BTN_SECONDARY =
	"inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";

/** Danger solid. */
export const UI_BTN_DANGER =
	"inline-flex items-center justify-center rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/** Compact ghost / toolbar control. */
export const UI_BTN_GHOST =
	"inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]";

/** Standard text field. */
export const UI_INPUT =
	"w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:bg-[var(--input-bg-focus)] focus:ring-2 focus:ring-[var(--input-ring)]";

/** Modal / popover shell. */
export const UI_MODAL_PANEL =
	"overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] shadow-[var(--shadow-lg)]";

/** Full-screen dimmer behind dialogs. */
export const UI_OVERLAY =
	"fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm";

/** List / table row hover. */
export const UI_ROW_HOVER = "transition hover:bg-[var(--surface-hover)]";

/** Soft elevated inset surface (replaces surface]/[0.04] hacks). */
export const UI_SURFACE_SOFT =
	"rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]";
