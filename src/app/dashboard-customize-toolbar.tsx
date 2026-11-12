"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import {
	DASHBOARD_WIDGET_LABELS,
	type DashboardWidgetId,
} from "@/lib/preferences/user-preferences";
import { ActionButton } from "@/components/action-button";
import { ArrowDown, ArrowUp } from "@/components/icons";
import { IconButton, Switch } from "@/components/ui-primitives";

/**
 * The dashboard's layout editor.
 *
 *   - View mode: one button, "Edit layout".
 *   - Edit mode: the widgets as a list in their order, each with move up / move down and a switch that shows
 *     or hides it, then "Reset to default" and "Done".
 *
 * The cards can also be dragged (DashboardPreferenceClient wires that), but dragging needs a mouse: the list
 * is the way that works from a keyboard and on a touch screen, and it shows hidden widgets, which have no
 * card to drag.
 *
 * The toolbar keeps no state: it reports what was asked (edit, done, reset, move, show/hide) and the parent
 * owns the order, the visibility and saving them.
 */
export function DashboardCustomizeToolbar({
	isEditing,
	onEnterEdit,
	onExitEdit,
	onReset,
	order,
	hiddenIds,
	onMove,
	onToggleVisibility,
}: {
	isEditing: boolean;
	onEnterEdit: () => void;
	onExitEdit: () => void;
	onReset: () => void;
	/** Every widget, in the order being edited. */
	order: readonly DashboardWidgetId[];
	hiddenIds: ReadonlySet<DashboardWidgetId>;
	onMove: (id: DashboardWidgetId, by: -1 | 1) => void;
	onToggleVisibility: (id: DashboardWidgetId) => void;
}) {
	const { t } = useI18n();

	if (!isEditing) {
		return (
			<div className="mb-3 flex items-center justify-end gap-2">
				<ActionButton size="sm" variant="secondary" onClick={onEnterEdit}>
					{t("dashboard.customize-edit")}
				</ActionButton>
			</div>
		);
	}

	return (
		<section data-card className="mb-4 flex flex-col gap-3 p-4" aria-label={t("dashboard.customize")}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="ui-title-group">{t("dashboard.customize")}</h2>
					<p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t("dashboard.customize-drag-tip")}</p>
				</div>
				<div className="flex items-center gap-2">
					<ActionButton size="sm" variant="secondary" onClick={onReset}>
						{t("dashboard.customize-reset")}
					</ActionButton>
					<ActionButton size="sm" variant="primary" onClick={onExitEdit} data-testid="customize-done">
						{t("dashboard.customize-done")}
					</ActionButton>
				</div>
			</div>
			<ol data-inset className="divide-y divide-[var(--border-subtle)]">
				{order.map((id, index) => {
					const hidden = hiddenIds.has(id);
					const name = t(DASHBOARD_WIDGET_LABELS[id]);
					return (
						<li key={id} data-widget-row={id} className="flex min-h-11 items-center gap-2 px-3 py-1">
							<span className={hidden ? "min-w-0 flex-1 truncate text-sm text-[var(--text-muted)]" : "min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]"}>
								{name}
							</span>
							<IconButton
								label={t("dashboard.customize-move-up", { name })}
								disabled={index === 0}
								onClick={() => onMove(id, -1)}
								data-testid={`move-up-${id}`}
							>
								<ArrowUp size={16} aria-hidden />
							</IconButton>
							<IconButton
								label={t("dashboard.customize-move-down", { name })}
								disabled={index === order.length - 1}
								onClick={() => onMove(id, 1)}
								data-testid={`move-down-${id}`}
							>
								<ArrowDown size={16} aria-hidden />
							</IconButton>
							<Switch
								checked={!hidden}
								onCheckedChange={() => onToggleVisibility(id)}
								label={t("dashboard.customize-visible", { name })}
								data-testid={`toggle-widget-${id}`}
								className="ml-1"
							/>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
