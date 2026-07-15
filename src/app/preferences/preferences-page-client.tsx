"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Switch } from "@/components/ui-primitives";
import { Bell, Home, LayoutDashboard, Radio, RefreshCw, User } from "@/components/icons";
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
		<section id={summaryId} className="scroll-mt-28" data-card>
			<div className="space-y-4 p-5 sm:p-6">
				<div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-3">
					<div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
						<span>{t("preferencesPage.group.personal")}</span>
					</div>
					<h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
						{summary?.icon && <span aria-hidden>{summary.icon}</span>}
						<span>{title}</span>
					</h2>
					{subtitle && <p className="text-xs leading-5 text-[var(--text-muted)]">{subtitle}</p>}
				</div>
				<div className="space-y-3">{children}</div>
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
	icon: ReactNode;
	title: string;
	subtitle: string;
};

export const PREFERENCES_CATEGORY_SUMMARIES: PreferencesCategorySummary[] = [
	{
		id: "personal-preferences",
		icon: <User size={18} />,
		title: "preferencesPage.category.personal.title",
		subtitle: "preferencesPage.category.personal.subtitle",
	},
	{
		id: "preferences-default-page",
		icon: <Home size={18} />,
		title: "preferencesPage.category.defaultPage.title",
		subtitle: "preferencesPage.category.defaultPage.subtitle",
	},
	{
		id: "preferences-dashboard-widgets",
		icon: <LayoutDashboard size={18} />,
		title: "preferencesPage.category.dashboardWidgets.title",
		subtitle: "preferencesPage.category.dashboardWidgets.subtitle",
	},
	{
		id: "preferences-notifications",
		icon: <Bell size={18} />,
		title: "preferencesPage.category.notifications.title",
		subtitle: "preferencesPage.category.notifications.subtitle",
	},
	{
		id: "preferences-auto-refresh",
		icon: <RefreshCw size={18} />,
		title: "preferencesPage.category.autoRefresh.title",
		subtitle: "preferencesPage.category.autoRefresh.subtitle",
	},
	{
		id: "preferences-auto-probe",
		icon: <Radio size={18} />,
		title: "preferencesPage.category.autoProbe.title",
		subtitle: "preferencesPage.category.autoProbe.subtitle",
	},
];

/** Toggle switch — extracted to module top to avoid re-creation on every render */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
	const sanitizedId = `preference-toggle-${hashLabel(label)}`;
	return (
		<div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_50%,var(--surface))] px-3.5 py-3">
			<span id={`${sanitizedId}-label`} className="text-sm text-[var(--text-secondary)]">
				{label}
			</span>
			<Switch
				id={sanitizedId}
				label={label}
				checked={checked}
				onCheckedChange={onChange}
			/>
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
	const savingRef = useRef(false);

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
		if (savingRef.current) return;
		savingRef.current = true;
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
		} finally {
			savingRef.current = false;
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
				<div role="status" className="mb-4 text-xs text-[var(--success)] bg-[var(--success-bg)] border border-[var(--success-border)] rounded-lg px-4 py-2">{t("preferencesPage.status.saved")}</div>
			)}
			{error && (
				<div role="alert" className="mb-4 text-xs text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-lg px-4 py-2">{error}</div>
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
											? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
											: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
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
										? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
										: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
					<p className="text-[11px] text-[var(--text-muted)]">{t("preferencesPage.hint.autoRefresh")}</p>
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
								onClick={() => {
									if (!prefs.autoProbeEnabled) return;
									save({ ...prefs, autoProbeIntervalSec: opt.value });
								}}
								disabled={!prefs.autoProbeEnabled}
								className={`px-3 py-1.5 text-xs rounded-lg border transition ${
									prefs.autoProbeIntervalSec === opt.value
										? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
										: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
								} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								{opt.label}
							</button>
						))}
					</div>
					<p className="text-[11px] text-[var(--text-muted)]">
						{t("preferencesPage.hint.autoProbe")}
					</p>
				</Section>
			</div>
		</>
	);

	if (loading) {
		const loadingContent = <div className="text-sm text-[var(--text-muted)]">{t("preferencesPage.loading")}</div>;
		return wrapInShell ? <PageShell>{loadingContent}</PageShell> : loadingContent;
	}

	return wrapInShell ? <PageShell>{content}</PageShell> : content;
}

export default function PreferencesPage() {
	return <PreferencesSettingsContent />;
}
