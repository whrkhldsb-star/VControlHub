"use client";

import { useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { REFRESH_INTERVAL_OPTIONS } from "@/lib/preferences/refresh-interval";
import {
	defaultUserPreferences,
	normalizeUserPreferences,
	type DashboardWidgetId,
	type DefaultPageOption,
	type UserPreferences,
} from "@/lib/preferences/user-preferences";

type Preferences = UserPreferences;

type InitialPreferencesState = {
	prefs: Preferences;
	hasStoredPrefs: boolean;
};

const defaultPrefs: Preferences = defaultUserPreferences;

function readInitialPreferencesState(): InitialPreferencesState {
	if (typeof window === "undefined") {
		return { prefs: defaultPrefs, hasStoredPrefs: false };
	}
	const local = window.localStorage.getItem("vps-preferences");
	if (!local) {
		return { prefs: defaultPrefs, hasStoredPrefs: false };
	}
	try {
		return {
			prefs: normalizeUserPreferences({ ...defaultPrefs, ...JSON.parse(local) }),
			hasStoredPrefs: true,
		};
	} catch {
		return { prefs: defaultPrefs, hasStoredPrefs: false };
	}
}

const pageOptions = [
	{ label: "仪表盘", value: "/" },
	{ label: "服务器管理", value: "/servers" },
	{ label: "文件管理", value: "/files" },
	{ label: "Docker 容器", value: "/docker" },
	{ label: "服务器监控", value: "/monitoring" },
	{ label: "下载站", value: "/downloads" },
	{ label: "AI 助手", value: "/ai" },
] satisfies Array<{ label: string; value: DefaultPageOption }>;

const widgetOptions = [
	{ label: "服务器状态", value: "server-status" },
	{ label: "快捷入口", value: "quick-links" },
	{ label: "数据图表", value: "analytics" },
	{ label: "审计日志", value: "audit-log" },
] satisfies Array<{ label: string; value: DashboardWidgetId }>;

/** Section card — extracted to module top to avoid re-creation on every render */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
			<h3 className="text-xs font-medium text-slate-400 light:text-slate-600 mb-4">{title}</h3>
			<div className="space-y-4">{children}</div>
		</div>
	);
}

/** Toggle switch — extracted to module top to avoid re-creation on every render */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between">
			<span id={`preference-toggle-${label}`} className="text-sm text-slate-300 light:text-slate-700">{label}</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-labelledby={`preference-toggle-${label}`}
				onClick={() => onChange(!checked)}
				className={`relative w-10 h-5 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${checked ? "bg-cyan-500" : "bg-slate-700"}`}
			>
				<span aria-hidden="true" className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition ${checked ? "translate-x-5" : ""}`} />
			</button>
		</div>
	);
}

export default function PreferencesPage() {
	const [{ prefs: initialPrefs, hasStoredPrefs }] = useState<InitialPreferencesState>(
		() => readInitialPreferencesState(),
	);
	const [prefs, setPrefs] = useState<Preferences>(initialPrefs);
	const [lastSavedPrefs, setLastSavedPrefs] = useState<Preferences>(() => initialPrefs);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(() => !hasStoredPrefs);
	const activeLoadRequestIdRef = useRef(0);
	const latestSaveRequestIdRef = useRef(0);

	const messageFromError = (err: unknown, fallback: string) => err instanceof Error && err.message ? err.message : fallback;

	useEffect(() => {
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
						setError(typeof data.error === "string" ? data.error : "偏好设置加载失败");
					}
				})
				.catch((err) => {
					if (loadRequestId !== activeLoadRequestIdRef.current || loadRequestId <= latestSaveRequestIdRef.current) {
						return;
					}
					setError(messageFromError(err, "偏好设置加载失败"));
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
	}, []);

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
			setError(messageFromError(err, "偏好设置保存失败"));
		}
	};

	const toggleWidget = (widget: DashboardWidgetId) => {
		const current = prefs.dashboardWidgets;
		const next = current.includes(widget)
			? current.filter((w) => w !== widget)
			: [...current, widget];
		save({ ...prefs, dashboardWidgets: next });
	};

	if (loading) return <PageShell><div className="text-sm text-slate-500">加载中...</div></PageShell>;

	return (
		<PageShell>
			<h1 className="text-2xl font-bold mb-1">个性化设置</h1>
			<p className="text-slate-400 light:text-slate-600 mb-6">自定义你的工作环境</p>
			{saved && (
				<div role="status" className="mb-4 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-4 py-2">✓ 设置已保存</div>
			)}
			{error && (
				<div role="alert" className="mb-4 text-xs text-rose-300 bg-rose-500/10 rounded-lg px-4 py-2">{error}</div>
			)}

			<div className="space-y-4 max-w-2xl">
				<Section title="🏠 默认页面">
					<div className="grid grid-cols-2 md:grid-cols-3 gap-2">
						{pageOptions.map((opt) => (
							<button
								key={opt.value}
								onClick={() => save({ ...prefs, defaultPage: opt.value })}
								className={`px-3 py-2 text-xs rounded-lg border transition ${
									prefs.defaultPage === opt.value
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
										: "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.04]"
								}`}
							>
								{opt.label}
							</button>
						))}
					</div>
				</Section>

				<Section title="📊 仪表盘组件">
					<div className="space-y-2">
						{widgetOptions.map((opt) => (
							<Toggle
								key={opt.value}
								label={opt.label}
								checked={prefs.dashboardWidgets.includes(opt.value)}
								onChange={() => toggleWidget(opt.value)}
							/>
						))}
					</div>
				</Section>

				<Section title="🔔 通知">
					<Toggle label="启用通知" checked={prefs.notificationsEnabled} onChange={(v) => save({ ...prefs, notificationsEnabled: v })} />
					<Toggle label="通知声音" checked={prefs.notificationSound} onChange={(v) => save({ ...prefs, notificationSound: v })} />
				</Section>

				<Section title="⏱️ 自动刷新">
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
					<p className="text-[11px] text-slate-500">控制服务器卡片、系统监控、流量中心和 Docker 统计的查询频率；调大间隔或关闭自动刷新可以明显减少请求和远程采样流量。</p>
				</Section>
			</div>
		</PageShell>
	);
}
