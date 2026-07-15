"use client";

import { useCallback } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import {
	DASHBOARD_WIDGET_IDS,
	DASHBOARD_WIDGET_LABELS,
	type DashboardWidgetId,
} from "@/lib/preferences/user-preferences";

/**
 * TR-020 dashboard customize toolbar.
 *
 * Renders a 3-state header strip above the dashboard grid:
 *   - View mode (default): [编辑布局]
 *   - Edit mode:           [完成] [恢复默认] + per-widget hide toggle
 *   - Saving mode:         [完成] disabled
 *
 * State management is intentionally local: the toolbar only emits
 * intent (onEnterEdit, onExitEdit, onReset, onToggleWidget) and lets
 * the parent (DashboardPreferenceClient) own the order/visibility
 * state and persistence.
 *
 * The "hide" button toggles a widget's visibility without removing
 * it from the order — re-showing it preserves its position. Hidden
 * widgets are rendered at the end in a 1-line collapsed row.
 */
export function DashboardCustomizeToolbar({
	isEditing,
	onEnterEdit,
	onExitEdit,
	onReset,
	hiddenIds,
	onToggleVisibility,
}: {
	isEditing: boolean;
	onEnterEdit: () => void;
	onExitEdit: () => void;
	onReset: () => void;
	hiddenIds: ReadonlySet<DashboardWidgetId>;
	onToggleVisibility: (id: DashboardWidgetId) => void;
}) {
	const { t } = useI18n();

	const handleToggle = useCallback(
		(id: DashboardWidgetId) => () => onToggleVisibility(id),
		[onToggleVisibility],
	);

	if (!isEditing) {
		return (
			<div className="mb-3 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onEnterEdit}
					className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
					aria-label={t("dashboard.customize-edit")}
				>
					{t("dashboard.customize-edit")}
				</button>
			</div>
		);
	}

	return (
		<div
			className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 shadow-[var(--shadow-sm)]"
			role="region"
			aria-label={t("dashboard.customize")}
		>
			<p className="px-1 text-xs leading-5 text-[var(--warning)]">
				{t("dashboard.customize-drag-tip")}
			</p>
			<div className="flex flex-wrap items-center gap-1.5">
				{DASHBOARD_WIDGET_IDS.map((id) => {
					const hidden = hiddenIds.has(id);
					return (
						<button
							key={id}
							type="button"
							onClick={handleToggle(id)}
							aria-pressed={hidden}
							data-testid={`toggle-widget-${id}`}
							className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
								hidden
									? "border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-muted)] line-through"
									: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
							}`}
						>
							{t(DASHBOARD_WIDGET_LABELS[id])} ·{" "}
							{hidden ? t("dashboard.customize-show") : t("dashboard.customize-hide")}
						</button>
					);
				})}
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onReset}
					className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
				>
					{t("dashboard.customize-reset")}
				</button>
				<button
					type="button"
					onClick={onExitEdit}
					data-testid="customize-done"
					className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]"
				>
					{t("dashboard.customize-done")}
				</button>
			</div>
		</div>
	);
}
