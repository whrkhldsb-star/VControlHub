"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/page-shell";
import { SegmentedTabs, SideNav, SplitPane, Callout } from "@/components/ui-primitives";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
import { PreferencesSettingsContent, PREFERENCES_CATEGORY_SUMMARIES } from "../preferences/preferences-page-client";
import { SettingsClient } from "./settings-client";
import { SystemConfigSection } from "./system-config-section";
import { TeamWorkspaceSection } from "./team-workspace-section";
import { SETTINGS_SCHEMA } from "./field-schema";

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

const PERSONAL_SECTION_IDS = [
  "preferences-default-page",
  "preferences-dashboard-widgets",
  "preferences-notifications",
  "preferences-auto-refresh",
  "preferences-auto-probe",
];

/** Map any section hash to its parent tab. */
const SECTION_TO_TAB: Record<string, SettingsTab> = {
  "personal-preferences": "personal",
  "preferences-default-page": "personal",
  "preferences-dashboard-widgets": "personal",
  "preferences-notifications": "personal",
  "preferences-auto-refresh": "personal",
  "preferences-auto-probe": "personal",
  security: "security",
  ...Object.fromEntries(
    Object.entries(TAB_SECTION_IDS).flatMap(([tab, ids]) =>
      ids.map((id) => [id, tab] as const),
    ),
  ),
};

const TAB_META: {
  id: SettingsTab;
  icon: string;
  labelKey: string;
  descKey: string;
}[] = [
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
  const [activeSection, setActiveSection] = useState<string>("preferences-default-page");

  const resolveHash = useCallback((hash: string): { tab: SettingsTab; sectionId: string } | null => {
    const id = hash.replace(/^#/, "");
    if (!id) return null;
    const tab = SECTION_TO_TAB[id];
    if (!tab) return null;
    return { tab, sectionId: id };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyHash = () => {
      const resolved = resolveHash(window.location.hash);
      if (resolved) {
        setActiveTab(resolved.tab);
        setActiveSection(resolved.sectionId);
        if (resolved.tab !== "personal") {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("vcontrolhub:settings-open-section", {
                detail: { id: resolved.sectionId },
              }),
            );
          }, 80);
        } else {
          // Scroll personal section into view
          setTimeout(() => {
            document.getElementById(resolved.sectionId)?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
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
    const firstSection =
      tab === "personal" ? "preferences-default-page" : TAB_SECTION_IDS[tab]?.[0] ?? "";
    if (firstSection && typeof window !== "undefined") {
      setActiveSection(firstSection);
      window.history.replaceState(null, "", `#${firstSection}`);
    }
  }, []);

  const handleSectionSelect = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#${sectionId}`);
      }
      if (activeTab !== "personal") {
        window.dispatchEvent(
          new CustomEvent("vcontrolhub:settings-open-section", {
            detail: { id: sectionId },
          }),
        );
      }
      setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 40);
    },
    [activeTab],
  );

  const tabs = canManage ? TAB_META : TAB_META.filter((tab) => tab.id === "personal");

  const tabCounts = useMemo(() => {
    return {
      personal: PERSONAL_SECTION_IDS.length,
      security: TAB_SECTION_IDS.security.length,
      notifications: TAB_SECTION_IDS.notifications.length,
      advanced: TAB_SECTION_IDS.advanced.length + (canManage ? 1 : 0),
    } as Record<SettingsTab, number>;
  }, [canManage]);

  const systemTab = activeTab !== "personal" ? activeTab : null;
  const visibleSectionIds = systemTab ? TAB_SECTION_IDS[systemTab] : TAB_SECTION_IDS.security;

  const sideItems = useMemo(() => {
    if (activeTab === "personal") {
      return PREFERENCES_CATEGORY_SUMMARIES.filter((s) => s.id !== "personal-preferences").map(
        (s) => ({
          id: s.id,
          icon: s.icon,
          label: t(s.title),
          description: t(s.subtitle),
        }),
      );
    }
    const ids = TAB_SECTION_IDS[activeTab] ?? [];
    return ids.map((id) => {
      const section = SETTINGS_SCHEMA.find((s) => s.id === id);
      let description: string | undefined;
      if (section) {
        const raw = section.descriptionKey;
        // descriptionKey may be a dynamic function of settings — use a short TOC hint instead
        description =
          typeof raw === "string"
            ? t(raw)
            : t(`settingsClient.toc.${id}.subtitle`) !== `settingsClient.toc.${id}.subtitle`
              ? t(`settingsClient.toc.${id}.subtitle`)
              : undefined;
      }
      return {
        id,
        icon: section?.icon ?? "•",
        label: section ? t(section.titleKey) : id,
        description,
      };
    });
  }, [activeTab, t]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t("settingsPage.unified.eyebrow")}
        title={t("settingsPage.unified.title")}
        description={t("settingsPage.unified.description")}
      />

      <Callout tone="accent" title={t("settingsPage.layout.tipTitle")}>
        {t("settingsPage.layout.tipBody")}
      </Callout>

      <div className="sticky top-2 z-30 -mx-1 px-1 sm:top-3">
        <SegmentedTabs
          ariaLabel={t("settingsClient.tabsAria")}
          value={activeTab}
          onChange={(id) => handleTabClick(id as SettingsTab)}
          items={tabs.map((tab) => ({
            id: tab.id,
            icon: tab.icon,
            label: t(tab.labelKey),
            description: t(tab.descKey),
            badge: tabCounts[tab.id],
          }))}
        />
      </div>

      <SplitPane
        rail={
          <SideNav
            ariaLabel={t("settingsClient.categoryNav")}
            items={sideItems}
            activeId={activeSection}
            onSelect={handleSectionSelect}
            className="hidden lg:block"
          />
        }
      >
        {/* Mobile section chips — same destinations as side rail */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden" role="navigation" aria-label={t("settingsClient.categoryNav")}>
          {sideItems.map((item) => {
            const active = item.id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSectionSelect(item.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {activeTab === "personal" && (
          <div className="space-y-5">
            <PreferencesSettingsContent showHeader={false} wrapInShell={false} />
            <TeamWorkspaceSection canManage={canManage} />
          </div>
        )}

        <div className={activeTab === "personal" ? "hidden" : "space-y-5"}>
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
      </SplitPane>
    </div>
  );
}
