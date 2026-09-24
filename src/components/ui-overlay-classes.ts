/**
 * Shared modal overlay class fragments that cannot live in `src/lib/ui/classes`
 * (components must own anything new; lib is frozen).
 *
 * Use with `ModalShell`'s `overlayClassName`. `UI_OVERLAY` in lib covers the
 * plain centered dimmer; these cover the recurring sheet / no-padding variants
 * that were previously pasted verbatim into every dialog.
 */

/**
 * Bottom-sheet modal overlay: panel docks to the bottom edge on mobile and
 * centers (with page padding) from `sm` up. The standard overlay for
 * mobile-friendly confirm / preview dialogs.
 */
export const UI_OVERLAY_SHEET =
	"fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--overlay)] p-0 backdrop-blur-sm sm:items-center sm:p-4";

/**
 * Bottom-sheet layout with the legacy surface-tinted dimmer instead of the
 * standard `--overlay` token (restore-backup confirm).
 */
export const UI_OVERLAY_SHEET_SURFACE =
	"fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--surface)]/75 p-0 backdrop-blur-sm sm:items-center sm:p-4";

/**
 * Centered overlay without page padding — for panels that carry their own
 * horizontal margin (`mx-4`) or must touch the viewport edge. Same as
 * ModalShell's default overlay minus `p-4`.
 */
export const UI_OVERLAY_CENTER =
	"fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm";
