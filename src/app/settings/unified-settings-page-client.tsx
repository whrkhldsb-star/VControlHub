"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useId, type ReactNode } from "react";
import { Bell, Database, Globe, HardDrive, Settings, Sparkles, User } from "@/components/icons";
import { IconKey } from "@/components/nav-items";
import { PageHeader } from "@/components/page-shell";
import { SegmentedTabs, SideNav, SplitPane } from "@/components/ui-primitives";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";
import { useI18n } from "@/lib/i18n/use-locale";
import { replaceBrowserUrl } from "@/lib/browser-history";
import { PreferencesSettingsContent, PREFERENCES_CATEGORY_SUMMARIES } from "../preferences/preferences-page-client";
import { SettingsClient } from "./settings-client";
import { SystemConfigSection } from "./system-config-section";
import { PublicStatusSettingsLink } from "./public-status-settings-link";
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
  defaultPageOptions?: readonly DefaultPageOption[];
};

type SettingsTab = "personal" | "platform" | "security" | "notifications" | "operations" | "storage" | "data" | "ai";
/** Platform tabs render SettingsClient sections; the personal tab renders its own panel. */
type PlatformTab = Exclude<SettingsTab, "personal">;
const isPlatformTab = (tab: SettingsTab): tab is PlatformTab => tab !== "personal";
/** Tabs every signed-in user may open. */
const SELF_SERVICE_TABS: SettingsTab[] = ["personal"];

const TAB_SECTION_IDS: Record<PlatformTab, string[]> = {
  platform: ["platform", "dashboard"],
  security: ["password", "securityPolicy"],
  notifications: ["smtp", "telegram", "alerts"],
  operations: ["runtime", "jobs"],
  storage: ["storage", "offsite"],
  data: ["monitoring", "retention"],
  ai: ["aiOps", "ai"],
};
/** The config export/import panel is rendered after the platform sections. */
const SYSTEM_CONFIG_TAB: PlatformTab = "platform";

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
  "system-config": SYSTEM_CONFIG_TAB,
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
  { id: "platform", icon: <Globe size={18} aria-hidden />, labelKey: "settingsPage.tab.platform", descKey: "settingsPage.tab.platform.desc" },
  { id: "security", icon: <IconKey />, labelKey: "settingsPage.tab.security", descKey: "settingsPage.tab.security.desc" },
  { id: "notifications", icon: <Bell size={18} aria-hidden />, labelKey: "settingsPage.tab.notifications", descKey: "settingsPage.tab.notifications.desc" },
  { id: "operations", icon: <Settings size={18} aria-hidden />, labelKey: "settingsPage.tab.operations", descKey: "settingsPage.tab.operations.desc" },
  { id: "storage", icon: <HardDrive size={18} aria-hidden />, labelKey: "settingsPage.tab.storage", descKey: "settingsPage.tab.storage.desc" },
  { id: "data", icon: <Database size={18} aria-hidden />, labelKey: "settingsPage.tab.data", descKey: "settingsPage.tab.data.desc" },
  { id: "ai", icon: <Sparkles size={18} aria-hidden />, labelKey: "settingsPage.tab.ai", descKey: "settingsPage.tab.ai.desc" },
];

export function UnifiedSettingsPageClient({
  settings,
  runtimeSettings = [],
  settingUpdateMetadata = {},
  canManage,
  isPlatformAdmin = false,
  defaultPageOptions = DEFAULT_PAGE_OPTIONS,
}: Props) {
  const { t } = useI18n();
  const [selectedTab, setActiveTab] = useState<SettingsTab>("personal");
  const activeTab = canManage || SELF_SERVICE_TABS.includes(selectedTab) ? selectedTab : "personal";
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
    if (!canManage && !SELF_SERVICE_TABS.includes(tab)) return { tab: "personal", sectionId: "preferences-default-page" };
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
      replaceBrowserUrl(`#${firstSection}`);
    }
  }, [cancelNavigation]);

  const handleSectionSelect = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);
      if (typeof window !== "undefined") {
        replaceBrowserUrl(`#${sectionId}`);
      }
      revealSection(sectionId, activeTab);
    },
    [activeTab, revealSection],
  );

  const tabs = canManage ? TAB_META : TAB_META.filter((tab) => SELF_SERVICE_TABS.includes(tab.id));

  const tabCounts = useMemo(() => {
    const counts = { personal: PERSONAL_SECTION_IDS.length } as Record<SettingsTab, number>;
    for (const [tab, ids] of Object.entries(TAB_SECTION_IDS) as [PlatformTab, string[]][]) {
      counts[tab] = ids.length + (tab === SYSTEM_CONFIG_TAB && canManage ? 1 : 0);
    }
    return counts;
  }, [canManage]);

  const systemTab = isPlatformTab(activeTab) ? activeTab : null;
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
    const ids = [...TAB_SECTION_IDS[activeTab], ...(activeTab === SYSTEM_CONFIG_TAB && canManage ? ["system-config"] : [])];
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
  }, [activeTab, canManage, t]);

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
          </div>


        <div className={systemTab ? "space-y-5" : "hidden"}>
          <SettingsClient
            settings={settings}
            runtimeSettings={runtimeSettings}
      settingUpdateMetadata={settingUpdateMetadata}
      canManage={canManage}
      showCategoryNav={false}
            visibleSectionIds={visibleSectionIds}
          />
          {/* The status board has its own page; monitoring settings link to it. */}
          {isPlatformAdmin && activeTab === "data" ? <PublicStatusSettingsLink /> : null}
          {canManage && <div id="system-config" className={activeTab === SYSTEM_CONFIG_TAB ? "scroll-mt-24" : "hidden"}>
            <SystemConfigSection isPlatformAdmin={isPlatformAdmin} />
          </div>}
        </div>
      </SplitPane>
      </div>
    </div>
  );
}
