"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useId, type ReactNode } from "react";
import { Bell, Settings, User } from "@/components/icons";
import { IconKey } from "@/components/nav-items";
import { PageHeader } from "@/components/page-shell";
import { SegmentedTabs, SideNav, SplitPane } from "@/components/ui-primitives";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
import { PreferencesSettingsContent, PREFERENCES_CATEGORY_SUMMARIES } from "../preferences/preferences-page-client";
import { SettingsClient } from "./settings-client";
import { SystemConfigSection } from "./system-config-section";
import { TeamWorkspaceSection, type TeamCapabilities } from "./team-workspace-section";
import { SETTINGS_SCHEMA } from "./field-schema";
import { TOC_SUBTITLE_KEYS } from "./settings-toc";
import { DEFAULT_PAGE_OPTIONS, type DefaultPageOption } from "@/lib/preferences/user-preferences";
import { UI_INPUT } from "@/lib/ui/classes";

type Props = {
  settings: Record<string, string>;
  runtimeSettings?: RuntimeSettingSummary[];
	settingUpdateMetadata?: Record<string, SettingUpdateMetadata>;
	canManage: boolean;
	/** Built-in `admin` role — required by the config import/export surface. */
	isPlatformAdmin?: boolean;
	teamCapabilities: TeamCapabilities;
	defaultPageOptions?: readonly DefaultPageOption[];
};

type SettingsTab = "personal" | "security" | "notifications" | "advanced";

const TAB_SECTION_IDS: Record<Exclude<SettingsTab, "personal">, string[]> = {
  security: ["platform", "password"],
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
  "system-config": "advanced",
  ...Object.fromEntries(
    Object.entries(TAB_SECTION_IDS).flatMap(([tab, ids]) =>
      ids.map((id) => [id, tab] as const),
    ),
  ),
};

const TAB_META: {
  id: SettingsTab;
  icon: ReactNode;
  labelKey: string;
  descKey: string;
}[] = [
  { id: "personal", icon: <User size={18} aria-hidden />, labelKey: "settingsPage.tab.personal", descKey: "settingsPage.tab.personal.desc" },
  { id: "security", icon: <IconKey />, labelKey: "settingsPage.tab.security", descKey: "settingsPage.tab.security.desc" },
  { id: "notifications", icon: <Bell size={18} aria-hidden />, labelKey: "settingsPage.tab.notifications", descKey: "settingsPage.tab.notifications.desc" },
  { id: "advanced", icon: <Settings size={18} aria-hidden />, labelKey: "settingsPage.tab.advanced", descKey: "settingsPage.tab.advanced.desc" },
];

export function UnifiedSettingsPageClient({
  settings,
  runtimeSettings = [],
	settingUpdateMetadata = {},
	canManage,
	isPlatformAdmin = false,
	teamCapabilities,
	defaultPageOptions = DEFAULT_PAGE_OPTIONS,
}: Props) {
  const { t } = useI18n();
  const [selectedTab, setActiveTab] = useState<SettingsTab>("personal");
  const activeTab = canManage ? selectedTab : "personal";
  const panelId = useId();
  const [activeSection, setActiveSection] = useState<string>("preferences-default-page");
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelNavigation = useCallback(() => {
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current);
    navigationTimer.current = null;
  }, []);
  const revealSection = useCallback((sectionId: string, tab: SettingsTab) => {
    cancelNavigation();
    navigationTimer.current = setTimeout(() => {
      navigationTimer.current = null;
      if (tab !== "personal") window.dispatchEvent(new CustomEvent("vcontrolhub:settings-open-section", { detail: { id: sectionId } }));
      navigationTimer.current = setTimeout(() => {
        navigationTimer.current = null;
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }, 80);
  }, [cancelNavigation]);

  const resolveHash = useCallback((hash: string): { tab: SettingsTab; sectionId: string } | null => {
    const id = hash.replace(/^#/, "");
    if (!id) return null;
    const tab = SECTION_TO_TAB[id];
    if (!tab) return null;
    if (!canManage && tab !== "personal") return { tab: "personal", sectionId: "preferences-default-page" };
    return { tab, sectionId: id };
  }, [canManage]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyHash = () => {
      cancelNavigation();
      if (window.location.hash === "#2fa") {
        // Legacy deep links used the administrator-only settings panel. 2FA
        // belongs to the signed-in account, so preserve the bookmark intent
        // while routing every role to the self-service page.
        window.location.replace("/account/security");
        return;
      }
      const resolved = resolveHash(window.location.hash);
      if (resolved) {
        setActiveTab(resolved.tab);
        setActiveSection(resolved.sectionId);
        revealSection(resolved.sectionId, resolved.tab);
      }
    };

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      cancelNavigation();
    };
  }, [resolveHash, revealSection, cancelNavigation]);

  const handleTabClick = useCallback((tab: SettingsTab) => {
    cancelNavigation();
    setActiveTab(tab);
    const firstSection =
      tab === "personal" ? "preferences-default-page" : TAB_SECTION_IDS[tab]?.[0] ?? "";
    if (firstSection && typeof window !== "undefined") {
      setActiveSection(firstSection);
      window.history.replaceState(window.history.state, "", `#${firstSection}`);
    }
  }, [cancelNavigation]);

  const handleSectionSelect = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);
      if (typeof window !== "undefined") {
        window.history.replaceState(window.history.state, "", `#${sectionId}`);
      }
      revealSection(sectionId, activeTab);
    },
    [activeTab, revealSection],
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
          label: t(s.title),
          description: t(s.subtitle),
        }),
      );
    }
    const ids = [...TAB_SECTION_IDS[activeTab], ...(activeTab === "advanced" ? ["system-config"] : [])];
    return ids.map((id) => {
      const section = SETTINGS_SCHEMA.find((s) => s.id === id);
      let description: string | undefined;
      if (section) {
        const raw = section.descriptionKey;
        // descriptionKey may be a dynamic function of settings — use TOC map (e.g. 2fa → twoFactor)
        if (typeof raw === "string") {
          description = t(raw);
        } else {
          const tocKey = TOC_SUBTITLE_KEYS[id];
          description =
            tocKey && t(tocKey) !== tocKey ? t(tocKey) : undefined;
        }
      }
      return {
        id,
        label: section ? t(section.titleKey) : t("systemConfig.title"),
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

      <div className="min-w-0">
        <SegmentedTabs
          ariaLabel={t("settingsClient.tabsAria")}
          value={activeTab}
          onChange={(id) => handleTabClick(id as SettingsTab)}
          items={tabs.map((tab) => ({
            id: tab.id,
            tabId: `${panelId}-${tab.id}-tab`,
            panelId: `${panelId}-panel`,
            icon: tab.icon,
            label: t(tab.labelKey),
            badge: tabCounts[tab.id],
          }))}
        />
      </div>

      <div role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-${activeTab}-tab`} tabIndex={0} className="min-w-0">
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
        <select className={`${UI_INPUT} lg:hidden`} aria-label={t("settingsClient.categoryNav")}
          value={sideItems.some((item) => item.id === activeSection) ? activeSection : sideItems[0]?.id}
          onChange={(event) => handleSectionSelect(event.target.value)}>
          {sideItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>

          <div className={activeTab === "personal" ? "space-y-5" : "hidden"}>
            <PreferencesSettingsContent
              showHeader={false}
              wrapInShell={false}
              defaultPageOptions={defaultPageOptions}
            />
            <TeamWorkspaceSection capabilities={teamCapabilities} />
          </div>

        <div className={activeTab === "personal" ? "hidden" : "space-y-5"}>
          <SettingsClient
            settings={settings}
            runtimeSettings={runtimeSettings}
			settingUpdateMetadata={settingUpdateMetadata}
			canManage={canManage}
			showCategoryNav={false}
            visibleSectionIds={visibleSectionIds}
          />
          {canManage && <div id="system-config" className={activeTab === "advanced" ? "scroll-mt-24" : "hidden"}>
            <SystemConfigSection isPlatformAdmin={isPlatformAdmin} />
          </div>}
        </div>
      </SplitPane>
      </div>
    </div>
  );
}
