"use client";

import { PageHeader } from "@/components/page-shell";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
import { PreferencesSettingsContent, PREFERENCES_CATEGORY_SUMMARIES } from "../preferences/preferences-page-client";
import { SettingsClient } from "./settings-client";
import { getTocItems } from "./field-schema-i18n";

type Props = {
	settings: Record<string, string>;
	runtimeSettings?: RuntimeSettingSummary[];
	settingUpdateMetadata?: Record<string, SettingUpdateMetadata>;
	canManage: boolean;
	twoFactorEnabled?: boolean;
};

function UnifiedSettingsCategoryNav() {
	const { t } = useI18n();
	const settingsItems = getTocItems(t);
	const personalItems = PREFERENCES_CATEGORY_SUMMARIES.map((item) => ({
		id: item.id,
		icon: item.icon,
		title: t(item.title),
		subtitle: t(item.subtitle),
	}));
	const items = [...personalItems, ...settingsItems];
	const expandAllSystemSettings = () => {
		window.dispatchEvent(new Event("vcontrolhub:settings-expand-all"));
	};
	const collapseAllSystemSettings = () => {
		window.dispatchEvent(new Event("vcontrolhub:settings-collapse-all"));
	};
	const openSystemSettingsSection = (id: string) => {
		if (!settingsItems.some((item) => item.id === id)) return;
		window.dispatchEvent(new CustomEvent("vcontrolhub:settings-open-section", { detail: { id } }));
	};

	return (
		<nav aria-label={t("settingsClient.categoryNav")} className="p-4 space-y-3" data-card>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 className="text-sm font-semibold text-white">{t("settingsPage.unified.categoryTitle")}</h2>
					<p className="mt-0.5 text-xs text-slate-500">{t("settingsPage.unified.categoryDescription")}</p>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={expandAllSystemSettings}
						className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
					>
						{t("settingsClient.expandAll")}
					</button>
					<button
						type="button"
						onClick={collapseAllSystemSettings}
						className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
					>
						{t("settingsClient.collapseAll")}
					</button>
				</div>
			</div>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{items.map((item) => (
					<a
						key={item.id}
						href={`#${item.id}`}
						onClick={() => openSystemSettingsSection(item.id)}
						className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.01] px-3 py-2 text-xs transition hover:border-cyan-400/30 hover:bg-cyan-500/[0.05]"
					>
						<span className="text-base" aria-hidden>{item.icon}</span>
						<span className="flex-1 min-w-0">
							<span className="block font-semibold text-white truncate">{item.title}</span>
							<span className="block text-[11px] text-slate-500 truncate">{item.subtitle}</span>
						</span>
						<span className="text-cyan-300 opacity-0 transition group-hover:opacity-100" aria-hidden>→</span>
					</a>
				))}
			</div>
		</nav>
	);
}

export function UnifiedSettingsPageClient({
	settings,
	runtimeSettings = [],
	settingUpdateMetadata = {},
	canManage,
	twoFactorEnabled = false,
}: Props) {
	const { t } = useI18n();

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow={t("settingsPage.unified.eyebrow")}
				title={t("settingsPage.unified.title")}
				description={t("settingsPage.unified.description")}
			/>
			<UnifiedSettingsCategoryNav />
			<PreferencesSettingsContent showHeader={false} wrapInShell={false} />
			<SettingsClient
				settings={settings}
				runtimeSettings={runtimeSettings}
				settingUpdateMetadata={settingUpdateMetadata}
				canManage={canManage}
				twoFactorEnabled={twoFactorEnabled}
				showCategoryNav={false}
			/>
		</div>
	);
}
