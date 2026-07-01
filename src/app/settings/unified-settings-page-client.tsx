"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/page-shell";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
import { PreferencesSettingsContent } from "../preferences/preferences-page-client";
import { SettingsClient } from "./settings-client";
import { SystemConfigSection } from "./system-config-section";
import { TeamWorkspaceSection } from "./team-workspace-section";

type Props = {
  settings: Record<string, string>;
  runtimeSettings?: RuntimeSettingSummary[];
  settingUpdateMetadata?: Record<string, SettingUpdateMetadata>;
  canManage: boolean;
  twoFactorEnabled?: boolean;
};

type SettingsTab = "personal" | "security" | "notifications" | "advanced";

const TAB_SECTION_IDS: Record<Exclude<SettingsTab, "personal">, string[]> = {
  security: ["2fa", "platform", "password"],
  notifications: ["smtp", "telegram"],
  advanced: ["runtime", "dashboard", "offsite", "aiOps"],
};

/** Map any section hash to its parent tab. */
const SECTION_TO_TAB: Record<string, SettingsTab> = {
  // personal preferences sections
  "personal-preferences": "personal",
  "preferences-default-page": "personal",
  "preferences-dashboard-widgets": "personal",
  "preferences-notifications": "personal",
  "preferences-auto-refresh": "personal",
  "preferences-auto-probe": "personal",
  // legacy aliases (backward-compat with existing deep links)
  security: "security",
  // system settings sections (from SETTINGS_SCHEMA)
  ...Object.fromEntries(
    Object.entries(TAB_SECTION_IDS).flatMap(([tab, ids]) =>
      ids.map((id) => [id, tab] as const),
    ),
  ),
};

const TAB_META: { id: SettingsTab; icon: string; labelKey: string; descKey: string }[] = [
  { id: "personal", icon: "👤", labelKey: "settingsPage.tab.personal", descKey: "settingsPage.tab.personal.desc" },
  { id: "security", icon: "🔒", labelKey: "settingsPage.tab.security", descKey: "settingsPage.tab.security.desc" },
  { id: "notifications", icon: "📢", labelKey: "settingsPage.tab.notifications", descKey: "settingsPage.tab.notifications.desc" },
  { id: "advanced", icon: "⚙️", labelKey: "settingsPage.tab.advanced", descKey: "settingsPage.tab.advanced.desc" },
];

export function UnifiedSettingsPageClient({
  settings,
  runtimeSettings = [],
  settingUpdateMetadata = {},
  canManage,
  twoFactorEnabled = false,
}: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("personal");

  // Resolve a hash fragment to its parent tab + section id.
  const resolveHash = useCallback((hash: string): { tab: SettingsTab; sectionId: string } | null => {
    const id = hash.replace(/^#/, "");
    if (!id) return null;
    const tab = SECTION_TO_TAB[id];
    if (!tab) return null;
    return { tab, sectionId: id };
  }, []);

  // On mount + hashchange, switch to the correct tab and let SettingsClient
  // handle opening/scrolling to the section within the tab.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyHash = () => {
      const resolved = resolveHash(window.location.hash);
      if (resolved) {
        setActiveTab(resolved.tab);
        // For system-settings sections, dispatch the open-section event so
        // SettingsClient (if mounted) opens and scrolls to the section.
        if (resolved.tab !== "personal") {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("vcontrolhub:settings-open-section", {
                detail: { id: resolved.sectionId },
              }),
            );
          }, 80);
        }
      }
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [resolveHash]);

  const handleTabClick = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
    // Update URL hash to the first section of the tab so deep-linking works
    const firstSection =
      tab === "personal"
        ? "personal-preferences"
        : TAB_SECTION_IDS[tab]?.[0] ?? "";
    if (firstSection && typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${firstSection}`);
    }
  }, []);

  const tabs = TAB_META;
  // Count sections per tab for the badge
  const tabCounts = useMemo(() => {
    const counts: Record<SettingsTab, number> = {
      personal: 5, // default-page, dashboard-widgets, notifications, auto-refresh, auto-probe
      security: TAB_SECTION_IDS.security.length,
      notifications: TAB_SECTION_IDS.notifications.length,
      advanced: TAB_SECTION_IDS.advanced.length,
    };
    return counts;
  }, []);

  // For non-personal tabs, SettingsClient stays mounted (hidden via CSS) so
  // that unsaved changes are preserved when switching between system-settings
  // tabs.  Only one SettingsClient instance is ever in the DOM.
  const systemTab = activeTab !== "personal" ? activeTab : null;
  const visibleSectionIds = systemTab ? TAB_SECTION_IDS[systemTab] : TAB_SECTION_IDS.security;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("settingsPage.unified.eyebrow")}
        title={t("settingsPage.unified.title")}
        description={t("settingsPage.unified.description")}
      />

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div
        className="sticky top-[3.5rem] z-30 -mx-1 px-1"
        role="tablist"
        aria-label={t("settingsClient.categoryNav")}
      >
        <nav
          className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 backdrop-blur-sm"
          data-card
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const count = tabCounts[tab.id];
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabClick(tab.id)}
                className={`group relative flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                  isActive
                    ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="text-base" aria-hidden>
                  {tab.icon}
                </span>
                <span className="flex flex-col items-start leading-tight">
                  <span>{t(tab.labelKey)}</span>
                  <span
                    className={`text-[10px] font-normal ${
                      isActive ? "text-[var(--accent)] opacity-70" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {t(tab.descKey)}
                  </span>
                </span>
                <span
                  className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                    isActive
                      ? "bg-[var(--accent)] text-[var(--surface-root)]"
                      : "bg-[var(--surface-elevated)] text-[var(--text-muted)]"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      {activeTab === "personal" && (
        <div className="space-y-6">
          <PreferencesSettingsContent showHeader={false} wrapInShell={false} />
          <TeamWorkspaceSection canManage={canManage} />
        </div>
      )}

      {/* SettingsClient stays mounted across system-settings tabs.
          When the personal tab is active it's hidden via CSS to preserve
          any unsaved field edits.  visibleSectionIds changes based on the
          active system tab, so only the relevant sections render. */}
      <div className={activeTab === "personal" ? "hidden" : ""}>
        <SettingsClient
          settings={settings}
          runtimeSettings={runtimeSettings}
          settingUpdateMetadata={settingUpdateMetadata}
          canManage={canManage}
          twoFactorEnabled={twoFactorEnabled}
          showCategoryNav={false}
          visibleSectionIds={visibleSectionIds}
        />
        {activeTab === "advanced" && canManage && <SystemConfigSection />}
      </div>
    </div>
  );
}
