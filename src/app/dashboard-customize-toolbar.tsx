"use client";

import { useCallback } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import {
	DASHBOARD_WIDGET_IDS,
	DASHBOARD_WIDGET_LABELS,
	type DashboardWidgetId,
} from "@/lib/preferences/user-preferences";
import { ActionButton } from "@/components/action-button";

import { Chip } from "@/components/ui-primitives";
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
				<ActionButton size="sm" variant="secondary"
					onClick={onEnterEdit}
					aria-label={t("dashboard.customize-edit")}>
					{t("dashboard.customize-edit")}
				</ActionButton>
			</div>
		);
	}

	return (
		<div
			className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3"
			role="region"
			aria-label={t("dashboard.customize")}
		>
			<p className="px-1 text-[13px] leading-5 text-[var(--text-secondary)]">
				{t("dashboard.customize-drag-tip")}
			</p>
			<div className="flex flex-wrap items-center gap-1.5">
				{DASHBOARD_WIDGET_IDS.map((id) => {
					const hidden = hiddenIds.has(id);
					return (
						<Chip
							key={id}
							selected={!hidden}
							tone="success"
							onClick={handleToggle(id)}
							data-testid={`toggle-widget-${id}`}
							title={hidden ? t("dashboard.customize-show") : t("dashboard.customize-hide")}
							className={hidden ? "line-through" : undefined}
						>
							{t(DASHBOARD_WIDGET_LABELS[id])}
						</Chip>
					);
				})}
			</div>
			<div className="flex items-center gap-2">
				<ActionButton size="sm" variant="secondary"
					onClick={onReset}>
					{t("dashboard.customize-reset")}
				</ActionButton>
				<ActionButton size="sm" variant="primary"
					onClick={onExitEdit}
					data-testid="customize-done">
					{t("dashboard.customize-done")}
				</ActionButton>
			</div>
		</div>
	);
}
