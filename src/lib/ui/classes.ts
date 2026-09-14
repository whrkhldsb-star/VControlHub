/**
 * Shared Tailwind class fragments for recurring UI patterns.
 *
 * Prefer ActionButton / SubmitButton / page-shell / ui-primitives when a full
 * interactive control is needed. Use these strings only for one-off markup
 * that cannot (yet) adopt a component without a larger rewrite.
 *
 * Keep fragments short and token-based — never hard-code white/black opacity.
 *
 * Token roles:
 *   - `--color-action*` = brand CTA cyan (ActionButton / SubmitButton primary)
 *   - `--accent*` = link / selection blue (nav active, text links)
 * Do not blindly replace one with the other; they are intentionally distinct.
 *
 * Single source of truth for form chrome: `UI_INPUT` (also re-exported as
 * CONTROL_CLASS from ui-primitives for backward compatibility).
 */

/** Solid primary CTA — prefer <ActionButton> / SubmitButton when possible. */
export const UI_BTN_PRIMARY =
	"inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-action)] px-3.5 py-2 text-sm font-semibold text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-hover)] disabled:cursor-not-allowed disabled:opacity-50";

/** Quiet secondary / cancel control. */
export const UI_BTN_SECONDARY =
	"inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50";

/** Danger solid fill — destructive confirms. Prefer ActionButton variant="danger-solid". */
export const UI_BTN_DANGER =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-danger-action)] px-3.5 py-2 text-sm font-semibold text-[var(--solid-action-fg)] transition hover:bg-[var(--color-danger-hover)] disabled:cursor-not-allowed disabled:opacity-50";

/** Success solid fill. Prefer ActionButton variant="success-solid". */
export const UI_BTN_SUCCESS =
	"inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-success-action)] px-3.5 py-2 text-sm font-semibold text-[var(--solid-action-fg)] transition hover:bg-[var(--color-success-hover)] disabled:cursor-not-allowed disabled:opacity-50";

/** Compact ghost / toolbar control. */
export const UI_BTN_GHOST =
	"inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]";

/**
 * Standard text field / select / textarea chrome.
 * Use with `data-input` when possible so globals.css theme rules apply.
 */
export const UI_INPUT =
	"min-h-10 w-full min-w-0 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:bg-[var(--input-bg-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)] disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--text-muted)]";

/** Compact search / toolbar field (smaller radius + padding). */
export const UI_INPUT_COMPACT = UI_INPUT;

/** Soft status pill — pair with tone border/bg/text tokens. */
export const UI_BADGE =
	"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ";

/** Modal / popover shell. */
export const UI_MODAL_PANEL =
	"overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] shadow-[var(--shadow-lg)]";

/** Full-screen dimmer behind dialogs. */
export const UI_OVERLAY =
	"fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm";

/** List / table row hover. */
export const UI_ROW_HOVER = "transition hover:bg-[var(--surface-hover)]";

/** Soft elevated inset surface (replaces surface/[0.04] hacks). */
export const UI_SURFACE_SOFT =
	"rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]";

/** Semantic tone maps for badges / alerts. */
export const UI_TONE = {
	success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
	info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
	accent: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
	neutral: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]",
} as const;

export type UiTone = keyof typeof UI_TONE;
