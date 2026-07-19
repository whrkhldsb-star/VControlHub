"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

import { useI18n } from "@/lib/i18n/use-locale";
import {
	DASHBOARD_WIDGET_IDS,
	DASHBOARD_WIDGET_LABELS,
	type DashboardWidgetId,
} from "@/lib/preferences/user-preferences";

/**
 * TR-020: Widget detail dialog.
 *
 * Click (or double-click) on a dashboard widget to pop this dialog with
 * a focused, scrollable detail view. We mount the existing widget DOM
 * (passed via `widgetRef`) into the dialog body — that way the detail
 * view stays in sync with the live widget and we don't need a parallel
 * implementation.
 *
 * Why dialog over route:
 *   - 4-column grid is a "summary" surface; users scan it quickly
 *   - The widget tree is already mounted — popping a dialog keeps the
 *     React tree stable (no remount, no extra data fetching)
 *   - A new `/dashboard/<id>` route would require 4 server-rendered
 *     pages and a parallel data fetch each visit
 *   - URL state is preserved via the dialog open/close (deep linking
 *     can be added later by syncing `open` with a `?detail=` param)
 */
export function DashboardWidgetDetailDialog({
	openId,
	onClose,
	widgetRef,
}: {
	openId: DashboardWidgetId | null;
	onClose: () => void;
	/**
	 * Ref to the dashboard grid container; we look up the open widget's
	 * DOM node via `widgetRef.current.querySelector(\`[data-dashboard-widget="\${openId}"]\`)`
	 * and clone it into the dialog body.
	 */
	widgetRef: React.RefObject<HTMLElement | null>;
}) {
	const { t } = useI18n();
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: openId !== null, onClose, initialFocusRef: closeRef });
	const [widgetEl, setWidgetEl] = useState<HTMLElement | null>(null);

	// Resolve the widget DOM node in a layout effect (not during render)
	// so we don't violate the React hooks rules about ref access.
	useLayoutEffect(() => {
		if (!openId || !widgetRef.current) {
			setWidgetEl(null);
			return;
		}
		const el = widgetRef.current.querySelector(
			`[data-dashboard-widget="${openId}"]`,
		) as HTMLElement | null;
		setWidgetEl(el);
	}, [openId, widgetRef]);

	if (!openId) return null;

	// Allow only known widget ids.
	if (!DASHBOARD_WIDGET_IDS.includes(openId)) return null;

	return (
		<div
			role="presentation"
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
			data-testid="dashboard-widget-detail-dialog"
			onClick={(e) => {
				// Click on backdrop closes; clicks on the dialog body do not.
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dashboard-widget-detail-title"
				className="relative max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-[var(--shadow-lg)] sm:p-6"
				>
				<div className="mb-4 flex items-center justify-between">
					<h2
						id="dashboard-widget-detail-title"
						className="text-lg font-semibold text-[var(--text-primary)]"
					>
						{t(DASHBOARD_WIDGET_LABELS[openId])}
					</h2>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label={t("dashboard.widget-detail-close")}
						data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm"
					>
						{t("dashboard.widget-detail-close")}
					</button>
				</div>
				<div className="dashboard-widget-detail-body text-sm text-[var(--text-primary)]">
					{widgetEl ? (
						// Render a clone of the live widget so the user sees
						// the same content as on the dashboard. We strip the
						// `display:none` style injected by the parent grid to
						// make sure hidden widgets can still be inspected.
						<WidgetClone host={widgetEl} />
						) : (
						<p className="text-[var(--text-secondary)]">{t("common.noContent")}</p>
						)}
				</div>
			</div>
		</div>
	);
}

function WidgetClone({ host }: { host: HTMLElement }) {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!ref.current) return;
		// Move the live DOM into our container. The original stays in
		// the grid; we just want a "detail surface" — to keep the live
		// widget interactive (links, buttons) we deep-clone instead.
		const clone = host.cloneNode(true) as HTMLElement;
		clone.removeAttribute("style");
		ref.current.replaceChildren(clone);
	}, [host]);
	return <div ref={ref} />;
}
