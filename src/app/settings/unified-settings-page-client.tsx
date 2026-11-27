"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useId, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bell, Database, Globe, HardDrive, Settings, Sparkles, User } from "@/components/icons";
import { IconKey } from "@/components/nav-items";
import { PageHeader } from "@/components/page-shell";
import { Notice, SegmentedTabs, SideNav, SplitPane } from "@/components/ui-primitives";
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

/**
 * The sections of the personal tab, from the list its menu is built from. Written out by hand they were one
 * short, and the address of the sixth opened the first.
 */
const PERSONAL_SECTION_IDS = PREFERENCES_CATEGORY_SUMMARIES.map((summary) => summary.id).filter((id) => id !== "personal-preferences");

/**
 * A tab's own name as an address (`/settings#notifications`) opens the tab at its first section, as the
 * section names (`#smtp`, `#telegram`, `#alerts`) open theirs.
 */
const TAB_HASH_FIRST_SECTION: Record<string, string> = Object.fromEntries(
  (Object.entries(TAB_SECTION_IDS) as [PlatformTab, string[]][])
    .filter(([, ids]) => ids[0] !== undefined)
    .map(([tab, ids]) => [tab, ids[0]!] as const),
);

/** Real section IDs take precedence over tab aliases when a section and tab share a name (such as `ai`). */
const EXACT_SECTION_IDS = new Set<string>([
  "personal-preferences",
  ...PERSONAL_SECTION_IDS,
  "security",
  "system-config",
  ...Object.values(TAB_SECTION_IDS).flat(),
]);

/** Map any section hash to its parent tab. */
const SECTION_TO_TAB: Record<string, SettingsTab> = {
  "personal-preferences": "personal",
  ...Object.fromEntries(PERSONAL_SECTION_IDS.map((id) => [id, "personal"] as const)),
  security: "security",
  "system-config": SYSTEM_CONFIG_TAB,
  ...Object.fromEntries(
    Object.entries(TAB_SECTION_IDS).flatMap(([tab, ids]) =>
      ids.map((id) => [id, tab] as const),
    ),
  ),
  ...Object.fromEntries(Object.keys(TAB_HASH_FIRST_SECTION).map((tab) => [tab, tab as SettingsTab] as const)),
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
  const router = useRouter();
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [refreshingSettings, startSettingsRefresh] = useTransition();
  const refreshImportedSettings = () => startSettingsRefresh(() => {
    router.refresh();
    setSettingsRevision((revision) => revision + 1);
  });
  const [activeSection, setActiveSection] = useState<string>("preferences-default-page");
  // Set when an address named a section only administrators can open: the page says why it opened the
  // personal tab instead of silently showing something else.
  const [reroutedFrom, setReroutedFrom] = useState<string | null>(null);
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

  const resolveHash = useCallback((hash: string): { tab: SettingsTab; sectionId: string; rerouted?: boolean } | null => {
    const id = hash.replace(/^#/, "");
    if (!id) return null;
    const tab = SECTION_TO_TAB[id];
    if (!tab) return null;
    if (!canManage && !SELF_SERVICE_TABS.includes(tab)) return { tab: "personal", sectionId: "preferences-default-page", rerouted: true };
    const sectionId = EXACT_SECTION_IDS.has(id) ? id : (TAB_HASH_FIRST_SECTION[id] ?? id);
    return { tab, sectionId };
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
        setReroutedFrom(resolved.rerouted ? window.location.hash.replace(/^#/, "") : null);
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

  const activeTabMeta = TAB_META.find((tab) => tab.id === activeTab);

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
          }))}
        />
        {/* What the open tab holds; the section counts that used to sit on the tabs read as unread counts. */}
        {activeTabMeta ? <p className="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">{t(activeTabMeta.descKey)}</p> : null}
      </div>

      {reroutedFrom ? (
        <Notice
          tone="info"
          title={t("settingsPage.rerouted.title")}
          onDismiss={() => setReroutedFrom(null)}
          dismissLabel={t("common.close")}
        >
          {t("settingsPage.rerouted.body")}
        </Notice>
      ) : null}

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
          <fieldset disabled={refreshingSettings} inert={refreshingSettings} className="min-w-0">
          <SettingsClient
            key={settingsRevision}
            settings={settings}
            runtimeSettings={runtimeSettings}
      settingUpdateMetadata={settingUpdateMetadata}
      canManage={canManage}
      showCategoryNav={false}
            visibleSectionIds={visibleSectionIds}
          />
          </fieldset>
          {/* The status board has its own page; monitoring settings link to it. */}
          {isPlatformAdmin && activeTab === "data" ? <PublicStatusSettingsLink /> : null}
          {canManage && <div id="system-config" className={activeTab === SYSTEM_CONFIG_TAB ? "scroll-mt-24" : "hidden"}>
            <SystemConfigSection isPlatformAdmin={isPlatformAdmin} onSettingsImported={refreshImportedSettings} />
          </div>}
        </div>
      </SplitPane>
      </div>
    </div>
  );
}
