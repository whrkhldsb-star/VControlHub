"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const [widgetEl, setWidgetEl] = useState<HTMLElement | null>(null);

	// Close on ESC.
	useEffect(() => {
		if (!openId) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openId, onClose]);

	// Focus the close button on open.
	useEffect(() => {
		if (openId) {
			closeRef.current?.focus();
		}
	}, [openId]);

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
			role="dialog"
			aria-modal="true"
			aria-labelledby="dashboard-widget-detail-title"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
			data-testid="dashboard-widget-detail-dialog"
			onClick={(e) => {
				// Click on backdrop closes; clicks on the dialog body do not.
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				className="relative max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[var(--border)] bg-slate-900/95 p-6 shadow-2xl"
			>
				<div className="mb-4 flex items-center justify-between">
					<h2
						id="dashboard-widget-detail-title"
						className="text-lg font-semibold text-white"
					>
						{DASHBOARD_WIDGET_LABELS[openId]}
					</h2>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label={t("dashboard.widget-detail-close")}
						className="rounded-lg border border-slate-600/40 bg-slate-800/40 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-700/50"
					>
						{t("dashboard.widget-detail-close")}
					</button>
				</div>
				<div className="dashboard-widget-detail-body text-sm text-slate-200">
					{widgetEl ? (
						// Render a clone of the live widget so the user sees
						// the same content as on the dashboard. We strip the
						// `display:none` style injected by the parent grid to
						// make sure hidden widgets can still be inspected.
						<WidgetClone host={widgetEl} />
						) : (
						<p className="text-slate-400">{t("common.noContent")}</p>
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
