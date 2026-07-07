"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import {
	DASHBOARD_WIDGET_IDS,
	DASHBOARD_WIDGET_LABELS,
	normalizeUserPreferences,
	type DashboardWidgetId,
	type UserPreferences,
} from "@/lib/preferences/user-preferences";

import { DashboardCustomizeToolbar } from "./dashboard-customize-toolbar";
import { DashboardWidgetDetailDialog } from "./dashboard-widget-detail-dialog";

export type DashboardPreferences = Pick<UserPreferences, "dashboardWidgets">;

const defaultDashboardPreferences: DashboardPreferences = {
	dashboardWidgets: [...DASHBOARD_WIDGET_IDS],
};

/**
 * TR-020: Dashboard layout container.
 *
 * Responsibilities:
 *   - Load/save user widget order + visibility from localStorage and /api/preferences
 *   - Inject a CSS rule per hidden widget (`display:none` on its `data-dashboard-widget`)
 *   - Inject a CSS rule per visible widget setting `order: N` so the grid reflects
 *     the user's chosen sequence without re-mounting React subtrees
 *   - Render a Customize toolbar (edit / reset / done / per-widget hide toggle)
 *   - Wire native HTML5 drag-and-drop on widget containers in edit mode so the
 *     user can reorder cards by dragging them
 *
 * State is local — no Redux / Zustand. The toolbar is "stateless" and only
 * emits intent (see DashboardCustomizeToolbar).
 */
export function DashboardPreferenceClient({
	children,
	// TR-020 M02: 系统设置里 admin 可关的拖拽重排总开关
	// 默认 true, 关闭后整个工具栏不再渲染 (用户看不到「编辑布局」入口)
	dragReorderEnabled = true,
}: {
	children: React.ReactNode;
	dragReorderEnabled?: boolean;
}) {
	const { t } = useI18n();
	const [preferences, setPreferences] = useState<DashboardPreferences>(defaultDashboardPreferences);
	const [isEditing, setIsEditing] = useState(false);
	const [draftOrder, setDraftOrder] = useState<DashboardWidgetId[] | null>(null);
	const [draftHidden, setDraftHidden] = useState<Set<DashboardWidgetId> | null>(null);
	const [dragId, setDragId] = useState<DashboardWidgetId | null>(null);
	const [openDetailId, setOpenDetailId] = useState<DashboardWidgetId | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);

	// Load preferences from localStorage and /api/preferences on mount.
	useEffect(() => {
		let active = true;

		const loadPreferences = (value: unknown) => {
			const nextPreferences = normalizeUserPreferences(value);
			if (active) {
				setPreferences({ dashboardWidgets: nextPreferences.dashboardWidgets });
			}
		};

		try {
			const raw = window.localStorage.getItem("vps-preferences");
			if (raw) loadPreferences(JSON.parse(raw));
		} catch {
			// Ignore broken local preference cache and fall back to server/defaults.
		}

		csrfFetch("/api/preferences")
			.then((data) => {
				const nextPreferences = normalizeUserPreferences(data);
				window.localStorage.setItem("vps-preferences", JSON.stringify(nextPreferences));
				loadPreferences(nextPreferences);
			})
			.catch(() => {
				// The dashboard itself is still usable; preference fetch failures should not hide widgets.
			});

		const onStorage = () => {
			try {
				const raw = window.localStorage.getItem("vps-preferences");
				loadPreferences(raw ? JSON.parse(raw) : null);
			} catch {
				// Stored preferences are corrupted or unparseable — reset to defaults.
				loadPreferences(null);
			}
		};
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);

		return () => {
			active = false;
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, []);

	const effectiveHidden = useMemo(() => {
		if (draftHidden) return draftHidden;
		// All visible = none hidden. We model "hidden" as a separate set on top of order.
		return new Set<DashboardWidgetId>();
	}, [draftHidden]);

	const hiddenWidgetIds = useMemo(() => {
		const visible = new Set(preferences.dashboardWidgets);
		return DASHBOARD_WIDGET_IDS.filter((id): id is DashboardWidgetId => !visible.has(id));
	}, [preferences.dashboardWidgets]);

	const visibleStyle = useMemo(() => {
		// Two layers of CSS injection:
		//   1. Hidden widgets: display:none (legacy behavior, also respects /api/preferences)
		//   2. Edit mode draft order: order: N on each widget
		const lines: string[] = [];
		for (const id of hiddenWidgetIds) {
			lines.push(`[data-dashboard-widget="${id}"]{display:none}`);
		}
		if (isEditing && draftOrder) {
			draftOrder.forEach((id, idx) => {
				if (effectiveHidden.has(id)) {
					lines.push(`[data-dashboard-widget="${id}"]{display:none}`);
				} else {
					lines.push(`[data-dashboard-widget="${id}"]{order:${idx}}`);
				}
			});
		}
		return lines.join("\n");
	}, [hiddenWidgetIds, isEditing, draftOrder, effectiveHidden]);

	// Persist preferences (order + visibility as a single array) to /api/preferences
	// and localStorage. The server stores `dashboardWidgets` as the ordered list
	// of *visible* widgets.
	const persistPreferences = useCallback(
		async (order: DashboardWidgetId[], hidden: Set<DashboardWidgetId>) => {
			const visibleOrder = order.filter((id) => !hidden.has(id));
			const next = { ...preferences, dashboardWidgets: visibleOrder };
			setPreferences(next);
			window.localStorage.setItem("vps-preferences", JSON.stringify(next));
			window.dispatchEvent(new Event("vps-preferences-updated"));
			try {
				await csrfFetch("/api/preferences", {
					method: "PUT",
					body: JSON.stringify({ dashboardWidgets: visibleOrder }),
				});
			} catch {
				// Persist locally; the next page load will reconcile.
			}
		},
		[preferences],
	);

	const handleEnterEdit = useCallback(() => {
		setIsEditing(true);
		setDraftOrder([...preferences.dashboardWidgets]);
		setDraftHidden(new Set());
	}, [preferences.dashboardWidgets]);

	const handleExitEdit = useCallback(async () => {
		if (draftOrder) {
			await persistPreferences(draftOrder, draftHidden ?? new Set());
		}
		setIsEditing(false);
		setDraftOrder(null);
		setDraftHidden(null);
		setDragId(null);
	}, [draftOrder, draftHidden, persistPreferences]);

	const handleReset = useCallback(() => {
		setDraftOrder([...DASHBOARD_WIDGET_IDS]);
		setDraftHidden(new Set());
	}, []);

	const handleToggleVisibility = useCallback(
		(id: DashboardWidgetId) => {
			setDraftHidden((prev) => {
				const base = prev ?? new Set<DashboardWidgetId>();
				const next = new Set(base);
				if (next.has(id)) {
					next.delete(id);
				} else {
					next.add(id);
				}
				return next;
			});
		},
		[],
	);

	// HTML5 drag-and-drop wiring — only enabled in edit mode.
	const handleDragStart = useCallback(
		(id: DashboardWidgetId) => (e: React.DragEvent) => {
			if (!isEditing) return;
			setDragId(id);
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", id);
		},
		[isEditing],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			if (!isEditing) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
		},
		[isEditing],
	);

	const handleDrop = useCallback(
		(targetId: DashboardWidgetId) => (e: React.DragEvent) => {
			if (!isEditing) return;
			e.preventDefault();
			const sourceId = (e.dataTransfer.getData("text/plain") as DashboardWidgetId) || dragId;
			if (!sourceId || sourceId === targetId) return;
			setDraftOrder((prev) => {
				const order = prev ?? [...preferences.dashboardWidgets];
				const srcIdx = order.indexOf(sourceId);
				const dstIdx = order.indexOf(targetId);
				if (srcIdx < 0 || dstIdx < 0) return order;
				const next = [...order];
				next.splice(srcIdx, 1);
				next.splice(dstIdx, 0, sourceId);
				return next;
			});
			setDragId(null);
		},
		[isEditing, dragId, preferences.dashboardWidgets],
	);

	const handleDragEnd = useCallback(() => {
		setDragId(null);
	}, []);

	// Wire draggable + listeners on each widget via React useEffect (replaces inline <script>).
	useEffect(() => {
		if (!isEditing) return;
		const root = gridRef.current;
		if (!root) return;

		const widgets = root.querySelectorAll<HTMLElement>("[data-dashboard-widget]");
		const cleanups: (() => void)[] = [];
		widgets.forEach((w) => {
			w.setAttribute("draggable", "true");
			const id = w.getAttribute("data-dashboard-widget") as DashboardWidgetId | null;
			if (!id) return;
			const onStart = handleDragStart(id) as unknown as EventListener;
			const onOver = handleDragOver as unknown as EventListener;
			const onDrop = handleDrop(id) as unknown as EventListener;
			w.addEventListener("dragstart", onStart);
			w.addEventListener("dragover", onOver);
			w.addEventListener("drop", onDrop);
			cleanups.push(() => {
				w.removeEventListener("dragstart", onStart);
				w.removeEventListener("dragover", onOver);
				w.removeEventListener("drop", onDrop);
				w.removeAttribute("draggable");
			});
		});

		return () => cleanups.forEach((fn) => fn());
	}, [isEditing, handleDragStart, handleDragOver, handleDrop]);


	// Render a per-widget wrapper that exposes dnd + order attributes when editing.
	// Done as a CSS-injection strategy (no React.Children.map re-ordering), so
	// the existing dashboard sections stay mounted in the same order React rendered
	// them — we just adjust `order` via inline CSS.
	return (
		<>
			<style>{visibleStyle}</style>
			{/* TR-020 M02: 系统设置关闭拖拽时, 整个工具栏不再渲染 */}
			{dragReorderEnabled ? (
				<DashboardCustomizeToolbar
					isEditing={isEditing}
					onEnterEdit={handleEnterEdit}
					onExitEdit={() => {
						void handleExitEdit();
					}}
					onReset={handleReset}
					hiddenIds={effectiveHidden}
					onToggleVisibility={handleToggleVisibility}
				/>
			) : null}
			<div
				ref={gridRef}
				className={
					isEditing
						? "grid grid-cols-1 gap-4"
						: "grid grid-cols-1 gap-4"
				}
				data-dashboard-edit={isEditing ? "true" : "false"}
				onClick={(e) => {
					// Only when NOT editing, and only when the click landed on
					// (or inside) a known widget. We use closest() to capture
					// child clicks too.
					if (isEditing) return;
					const target = e.target as HTMLElement | null;
					const widgetEl = target?.closest<HTMLElement>("[data-dashboard-widget]");
					if (!widgetEl) return;
					const id = widgetEl.getAttribute("data-dashboard-widget") as DashboardWidgetId | null;
					if (!id || !DASHBOARD_WIDGET_IDS.includes(id)) return;
					setOpenDetailId(id);
				}}
				{...(isEditing
					? {
							onDragOver: handleDragOver,
							onDragEnd: handleDragEnd,
						}
					: {})}
			>
				{children}
			</div>
			
			{/* Drag-and-drop wired via React useEffect using gridRef querySelectorAll. */}
			
			{isEditing ? (
				<p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
					{t("dashboard.customize-drag-tip")}
				</p>
			) : null}
			<DashboardWidgetDetailDialog
				openId={openDetailId}
				onClose={() => setOpenDetailId(null)}
				widgetRef={gridRef}
			/>
		</>
	);
}

export { DASHBOARD_WIDGET_LABELS };
