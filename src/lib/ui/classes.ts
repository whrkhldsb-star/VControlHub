/**
 * Shared Tailwind class strings for form controls — the one place their look
 * is defined. Everything else has a component or data attribute:
 *
 *   buttons   <ActionButton> / <ButtonLink> / <SubmitButton> ([data-action-button])
 *   surfaces  <Card> / data-card · data-inset · data-tile
 *   dialogs   <Dialog> / <ConfirmDialog> / <ModalShell size placement>
 *   menus     <Menu> / data-popover · data-menu-item
 *   badges    <Badge> (tags) · <StatusBadge> (states)
 *
 * See docs/ui-system.md. Keep fragments token-based — never hard-code
 * white/black opacity.
 */

/**
 * Field label. Like UI_INPUT it is a components-layer rule (`.ui-label` in
 * globals.css), so <FormField> and hand-written labels share one look.
 */
export const UI_LABEL = "ui-label";

/**
 * Text field / select / textarea chrome. The look is the `.ui-control` rule in
 * globals.css (components layer), so width, padding or size utilities added
 * next to it always win — `cn(UI_INPUT, "w-40")` really is 10rem wide.
 * Add `data-input` and `data-error="true"` for the error state.
 */
export const UI_INPUT = "ui-control";

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
