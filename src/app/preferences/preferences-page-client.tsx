"use client";

import { useEffect, useRef, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { REFRESH_INTERVAL_OPTIONS } from "@/lib/preferences/refresh-interval";
import { AUTO_PROBE_INTERVAL_OPTIONS } from "@/lib/preferences/auto-probe";
import { useI18n } from "@/lib/i18n/use-locale";
import {
	defaultUserPreferences,
	normalizeUserPreferences,
	type DashboardWidgetId,
	type DefaultPageOption,
	type UserPreferences,
} from "@/lib/preferences/user-preferences";

type Preferences = UserPreferences;

const defaultPrefs: Preferences = defaultUserPreferences;

function readStoredPreferences(): Preferences | null {
	if (typeof window === "undefined") {
		return null;
	}
	const local = window.localStorage.getItem("vps-preferences");
	if (!local) {
		return null;
	}
	try {
		return normalizeUserPreferences({ ...defaultPrefs, ...JSON.parse(local) });
	} catch {
		return null;
	}
}

const PAGE_KEYS: Record<DefaultPageOption, string> = {
	"/": "preferencesPage.page.dashboard",
	"/servers": "preferencesPage.page.servers",
	"/files": "preferencesPage.page.files",
	"/docker": "preferencesPage.page.docker",
	"/monitoring": "preferencesPage.page.monitoring",
	"/downloads": "preferencesPage.page.downloads",
	"/ai": "preferencesPage.page.ai",
};

const WIDGET_KEYS: Record<DashboardWidgetId, string> = {
	"server-status": "preferencesPage.widget.serverStatus",
	"quick-links": "preferencesPage.widget.quickLinks",
	analytics: "preferencesPage.widget.analytics",
	"audit-log": "preferencesPage.widget.auditLog",
};

function pageLabel(t: (key: string) => string, value: DefaultPageOption): string {
	return t(PAGE_KEYS[value] ?? "preferencesPage.page.dashboard");
}

function widgetLabel(t: (key: string) => string, value: DashboardWidgetId): string {
	return t(WIDGET_KEYS[value] ?? "preferencesPage.widget.serverStatus");
}

/** Section card — extracted to module top to avoid re-creation on every render */
function Section({
	summaryId,
	children,
}: {
	summaryId: Exclude<PreferencesCategorySummaryId, "personal-preferences">;
	children: React.ReactNode;
}) {
	const { t } = useI18n();
	const summary = PREFERENCES_CATEGORY_SUMMARIES.find((item) => item.id === summaryId);
	const title = summary ? t(summary.title) : summaryId;
	const subtitle = summary ? t(summary.subtitle) : "";
	return (
		<section id={summaryId} className="scroll-mt-24" data-card>
			<div className="p-5 space-y-4">
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
						<span>{t("preferencesPage.group.personal")}</span>
					</div>
					<h2 className="text-lg font-semibold text-white flex items-center gap-2 flex-wrap">
						{summary?.icon && <span aria-hidden>{summary.icon}</span>}
						<span>{title}</span>
					</h2>
					{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
				</div>
				<div className="space-y-4">{children}</div>
			</div>
		</section>
	);
}

type PreferencesCategorySummaryId =
	| "personal-preferences"
	| "preferences-default-page"
	| "preferences-dashboard-widgets"
	| "preferences-notifications"
	| "preferences-auto-refresh"
	| "preferences-auto-probe";

export type PreferencesCategorySummary = {
	id: PreferencesCategorySummaryId;
	icon: string;
	title: string;
	subtitle: string;
};

export const PREFERENCES_CATEGORY_SUMMARIES: PreferencesCategorySummary[] = [
	{
		id: "personal-preferences",
		icon: "👤",
		title: "preferencesPage.category.personal.title",
		subtitle: "preferencesPage.category.personal.subtitle",
	},
	{
		id: "preferences-default-page",
		icon: "🏠",
		title: "preferencesPage.category.defaultPage.title",
		subtitle: "preferencesPage.category.defaultPage.subtitle",
	},
	{
		id: "preferences-dashboard-widgets",
		icon: "📊",
		title: "preferencesPage.category.dashboardWidgets.title",
		subtitle: "preferencesPage.category.dashboardWidgets.subtitle",
	},
	{
		id: "preferences-notifications",
		icon: "🔔",
		title: "preferencesPage.category.notifications.title",
		subtitle: "preferencesPage.category.notifications.subtitle",
	},
	{
		id: "preferences-auto-refresh",
		icon: "🔄",
		title: "preferencesPage.category.autoRefresh.title",
		subtitle: "preferencesPage.category.autoRefresh.subtitle",
	},
	{
		id: "preferences-auto-probe",
		icon: "🛰️",
		title: "preferencesPage.category.autoProbe.title",
		subtitle: "preferencesPage.category.autoProbe.subtitle",
	},
];

/** Toggle switch — extracted to module top to avoid re-creation on every render */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
	// HTML id 不允许空格 / 斜杠 / 中文等字符; 用稳定 hash 替代文字 id,
	// 这样 aria-labelledby 在长 label (含中点 / URL) 下也能正确解析。
	const sanitizedId = `preference-toggle-${hashLabel(label)}`;
	return (
		<div className="flex items-center justify-between">
			<span id={sanitizedId} className="text-sm text-[var(--text-secondary)]">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-labelledby={sanitizedId}
				onClick={() => onChange(!checked)}
				className={`relative w-10 h-5 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${checked ? "bg-cyan-500" : "bg-slate-700"}`}
			>
				<span aria-hidden="true" className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition ${checked ? "translate-x-5" : ""}`} />
			</button>
		</div>
	);
}

function hashLabel(label: string): string {
	// FNV-1a 32-bit — 稳定、轻量、零依赖。足够给 label → id 散列用。
	let h = 0x811c9dc5;
	for (let i = 0; i < label.length; i++) {
		h ^= label.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	// 转无符号 + 8 位 hex
	return (h >>> 0).toString(16).padStart(8, "0");
}

export function PreferencesSettingsContent({
	showHeader = true,
	wrapInShell = true,
}: {
	showHeader?: boolean;
	wrapInShell?: boolean;
}) {
	const { t } = useI18n();
	const [prefs, setPrefs] = useState<Preferences>(defaultPrefs);
	const [lastSavedPrefs, setLastSavedPrefs] = useState<Preferences>(() => defaultPrefs);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const activeLoadRequestIdRef = useRef(0);
	const latestSaveRequestIdRef = useRef(0);

	const messageFromError = (err: unknown, fallback: string) => err instanceof Error && err.message ? err.message : fallback;

	useEffect(() => {
		const storedPrefs = readStoredPreferences();
		if (storedPrefs) {
			// Local cache must be applied immediately after hydration so preference buttons do not flash defaults.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setPrefs(storedPrefs);
			setLastSavedPrefs(storedPrefs);
			setLoading(false);
		}
		const loadRequestId = activeLoadRequestIdRef.current + 1;
		activeLoadRequestIdRef.current = loadRequestId;
		const timer = window.setTimeout(() => {
			csrfFetch("/api/preferences")
				.then((data) => {
					if (loadRequestId !== activeLoadRequestIdRef.current || loadRequestId <= latestSaveRequestIdRef.current) {
						return;
					}
					if (!data.error) {
						const nextPrefs = normalizeUserPreferences({ ...defaultPrefs, ...data });
						setPrefs(nextPrefs);
						setLastSavedPrefs(nextPrefs);
						localStorage.setItem("vps-preferences", JSON.stringify(nextPrefs));
						setError("");
					} else {
						setError(typeof data.error === "string" ? data.error : t("preferencesPage.error.load"));
					}
				})
				.catch((err) => {
					if (loadRequestId !== activeLoadRequestIdRef.current || loadRequestId <= latestSaveRequestIdRef.current) {
						return;
					}
					setError(messageFromError(err, t("preferencesPage.error.load")));
				})
				.finally(() => {
					if (loadRequestId !== activeLoadRequestIdRef.current || loadRequestId <= latestSaveRequestIdRef.current) {
						return;
					}
					setLoading(false);
				});
		}, 0);
		return () => {
			activeLoadRequestIdRef.current += 1;
			window.clearTimeout(timer);
		};
	}, [t]);

	const save = async (newPrefs: Preferences) => {
		const normalizedPrefs = normalizeUserPreferences(newPrefs);
		const saveRequestId = latestSaveRequestIdRef.current + 1;
		latestSaveRequestIdRef.current = saveRequestId;
		activeLoadRequestIdRef.current = Math.max(activeLoadRequestIdRef.current, saveRequestId);
		setPrefs(normalizedPrefs);
		setError("");
		setSaved(false);
		try {
			const savedPrefs = await csrfFetch("/api/preferences", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(normalizedPrefs),
			});
			const nextPrefs = normalizeUserPreferences({ ...normalizedPrefs, ...savedPrefs });
			setPrefs(nextPrefs);
			setLastSavedPrefs(nextPrefs);
			localStorage.setItem("vps-preferences", JSON.stringify(nextPrefs));
			window.dispatchEvent(new Event("vps-preferences-updated"));
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch (err) {
			setPrefs(lastSavedPrefs);
			localStorage.setItem("vps-preferences", JSON.stringify(lastSavedPrefs));
			setError(messageFromError(err, t("preferencesPage.error.save")));
		}
	};

	const toggleWidget = (widget: DashboardWidgetId) => {
		const current = prefs.dashboardWidgets;
		const next = current.includes(widget)
			? current.filter((w) => w !== widget)
			: [...current, widget];
		save({ ...prefs, dashboardWidgets: next });
	};

	const content = (
		<>
			{showHeader && <PageHeader eyebrow={t("preferencesPage.eyebrow")} title={t("preferencesPage.title")} description={t("preferencesPage.desc")} />}
			{saved && (
				<div role="status" className="mb-4 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-4 py-2">{t("preferencesPage.status.saved")}</div>
			)}
			{error && (
				<div role="alert" className="mb-4 text-xs text-rose-300 bg-rose-500/10 rounded-lg px-4 py-2">{error}</div>
			)}

			<div id="personal-preferences" className="space-y-4 max-w-2xl scroll-mt-24">
				<Section summaryId="preferences-default-page">
					<div className="grid grid-cols-2 md:grid-cols-3 gap-2">
						{(Object.keys(PAGE_KEYS) as DefaultPageOption[]).map((value) => (
							<button
								key={value}
								onClick={() => save({ ...prefs, defaultPage: value })}
								className={`px-3 py-2 text-xs rounded-lg border transition ${
									prefs.defaultPage === value
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
										: "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
								}`}
							>
								{pageLabel(t, value)}
							</button>
						))}
					</div>
				</Section>

				<Section summaryId="preferences-dashboard-widgets">
					<div className="space-y-2">
						{(Object.keys(WIDGET_KEYS) as DashboardWidgetId[]).map((value) => (
							<Toggle
								key={value}
								label={widgetLabel(t, value)}
								checked={prefs.dashboardWidgets.includes(value)}
								onChange={() => toggleWidget(value)}
							/>
						))}
					</div>
				</Section>

				<Section summaryId="preferences-notifications">
					<Toggle label={t("preferencesPage.toggle.notifications")} checked={prefs.notificationsEnabled} onChange={(v) => save({ ...prefs, notificationsEnabled: v })} />
					<Toggle label={t("preferencesPage.toggle.notificationSound")} checked={prefs.notificationSound} onChange={(v) => save({ ...prefs, notificationSound: v })} />
				</Section>

				<Section summaryId="preferences-auto-refresh">
					<div className="flex flex-wrap gap-2">
						{REFRESH_INTERVAL_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								onClick={() => save({ ...prefs, autoRefreshInterval: opt.value })}
								className={`px-3 py-1.5 text-xs rounded-lg border transition ${
									prefs.autoRefreshInterval === opt.value
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
										: "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
					<p className="text-[11px] text-slate-500">{t("preferencesPage.hint.autoRefresh")}</p>
				</Section>

				<Section summaryId="preferences-auto-probe">
					<Toggle
						label={t("preferencesPage.toggle.autoProbe")}
						checked={prefs.autoProbeEnabled}
						onChange={(v) => save({ ...prefs, autoProbeEnabled: v })}
					/>
					<div className="flex flex-wrap gap-2">
						{AUTO_PROBE_INTERVAL_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								onClick={() => save({ ...prefs, autoProbeIntervalSec: opt.value })}
								disabled={!prefs.autoProbeEnabled}
								className={`px-3 py-1.5 text-xs rounded-lg border transition ${
									prefs.autoProbeIntervalSec === opt.value
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
										: "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
								} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								{opt.label}
							</button>
						))}
					</div>
					<p className="text-[11px] text-slate-500">
						{t("preferencesPage.hint.autoProbe")}
					</p>
				</Section>
			</div>
		</>
	);

	if (loading) {
		const loadingContent = <div className="text-sm text-slate-500">{t("preferencesPage.loading")}</div>;
		return wrapInShell ? <PageShell>{loadingContent}</PageShell> : loadingContent;
	}

	return wrapInShell ? <PageShell>{content}</PageShell> : content;
}

export default function PreferencesPage() {
	return <PreferencesSettingsContent />;
}
