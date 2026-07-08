"use client";

/**
 * SettingsClient — orchestration shell for the unified settings page.
 *
 * R31 split: everything below moved out to siblings:
 *   - settings-fields.tsx        → FieldRenderer + Input/Select/Switch/TextArea
 *   - settings-field-risk.tsx    → FieldRiskBadge + FieldRollbackButton
 *   - settings-save-confirm.tsx  → PendingChange / SaveButtonWithDiff /
 *                                  HighRiskConfirmModal / getPendingChanges /
 *                                  renderDiffValue
 *   - settings-section.tsx       → SchemaDrivenSection + CollapsibleSection +
 *                                  AuditSummary + metadata helpers
 *
 * This file is now the glue: persistent settings state, schema-driven
 * <SchemaDrivenSection> mapping, save flow with high-risk confirmation,
 * URL-hash deep linking, and the TR-014 M02 high-risk blur warning Set.
 *
 * Backwards-compat re-exports below keep existing test imports green:
 *   - import { FieldRiskBadge, FieldRollbackButton } from "@/app/settings/settings-client"
 */
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type SyntheticEvent,
} from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";

import {
  SETTINGS_SCHEMA,
  getSectionSaveKeys,
  type FieldDef,
  type FieldValidationError,
  type SectionDef,
} from "./field-schema";
import {
  HighRiskConfirmModal,
  getPendingChanges,
  type PendingChange,
} from "./settings-save-confirm";
import {
  SchemaDrivenSection,
  latestSectionMetadata,
} from "./settings-section";

// Re-export so test files importing from `settings-client` keep working.
export { FieldRiskBadge, FieldRollbackButton } from "./settings-field-risk";
export type { PendingChange } from "./settings-save-confirm";

const TOC_SUBTITLE_KEYS: Record<string, string> = {
  "2fa": "settingsClient.toc.twoFactor.subtitle",
  platform: "settingsClient.toc.platform.subtitle",
  password: "settingsClient.toc.password.subtitle",
  smtp: "settingsClient.toc.smtp.subtitle",
  telegram: "settingsClient.toc.telegram.subtitle",
  runtime: "settingsClient.toc.runtime.subtitle",
  dashboard: "settingsClient.toc.dashboard.subtitle",
  offsite: "settingsClient.toc.offsite.subtitle",
  aiOps: "settingsClient.toc.aiOps.subtitle",
};

type Props = {
  settings: Record<string, string>;
  runtimeSettings?: RuntimeSettingSummary[];
  settingUpdateMetadata?: Record<string, SettingUpdateMetadata>;
  canManage: boolean;
  twoFactorEnabled?: boolean;
  showCategoryNav?: boolean;
  /** When set, only sections whose id is in this array are rendered. */
  visibleSectionIds?: string[];
};

export function SettingsClient({
  settings: initialSettings,
  runtimeSettings = [],
  settingUpdateMetadata = {},
  canManage,
  twoFactorEnabled = false,
  showCategoryNav = true,
  visibleSectionIds,
}: Props) {
  const { t } = useI18n();
  // Schema now holds i18n keys directly — rendering components call t()/tt()
  // to resolve them. No bridge layer needed.
  const schema = SETTINGS_SCHEMA;
  const tt = (key: string, vars?: Record<string, string | number>) => {
    let s = t(key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  const tocItems = useMemo(() =>
    SETTINGS_SCHEMA.map((s) => {
      const subtitleKey = TOC_SUBTITLE_KEYS[s.id] ?? `settingsClient.toc.fieldsCount.suffix`;
      const count = `${s.fields.length}${t("settingsClient.toc.fieldsCount.suffix")}`;
      return {
        id: s.id,
        icon: s.icon,
        title: s.id === "smtp" ? t("settingsClient.toc.smtp.titleShort") : t(s.titleKey),
        subtitle: TOC_SUBTITLE_KEYS[s.id] ? t(subtitleKey) : count,
      };
    }),
  [t]);
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // TR-014 M01b: second-confirm modal state for saving high-risk fields
  const [highRiskConfirm, setHighRiskConfirm] = useState<{
    changes: PendingChange[];
    execute: () => void;
  } | null>(null);
  // TR-014 M01b: per-section diff-pill expanded state
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  // TR-014 M02: when the user blurs a high-risk field with an unsaved
  // change, show an inline warning under that field until either the
  // value is reverted or the section is saved.
  const [blurredHighRiskKeys, setBlurredHighRiskKeys] = useState<Set<string>>(
    () => new Set(),
  );

  // Initial section open/closed map from schema (defaultOpen).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, s.defaultOpen])),
  );

  // TR-014 M02: track which high-risk fields the user has blurred with
  // a pending edit. Only fires when level==='high' and the value
  // diverges from the initial snapshot.
  const handleHighRiskBlur = useCallback(
    (field: FieldDef, currentValue: string) => {
      if (field.riskLevel !== "high") return;
      const initialValue = initialSettings[field.key] ?? "";
      if (currentValue === initialValue) return;
      setBlurredHighRiskKeys((prev) => {
        if (prev.has(field.key)) return prev;
        const next = new Set(prev);
        next.add(field.key);
        return next;
      });
    },
    [initialSettings],
  );

  // TR-014 M02: clear the warning as soon as the user types again — they
  // may be reverting or starting a new edit; re-warn on the next blur.
  const clearHighRiskBlur = useCallback((field: FieldDef) => {
    setBlurredHighRiskKeys((prev) => {
      if (!prev.has(field.key)) return prev;
      const next = new Set(prev);
      next.delete(field.key);
      return next;
    });
  }, []);

  const handleToggle = useCallback(
    (id: string) => (event: SyntheticEvent<HTMLDetailsElement>) => {
      const isOpen = (event.currentTarget as HTMLDetailsElement)?.open ?? false;
      setOpenSections((prev) => ({ ...prev, [id]: isOpen }));
    },
    [],
  );

  const expandAll = useCallback(() => {
    setOpenSections(Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, true])));
  }, []);
  const collapseAll = useCallback(() => {
    setOpenSections(Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, false])));
  }, []);

  // Apply URL hash (e.g. /settings#runtime) on mount and react to the
  // unified-settings category nav: open the section and scroll into view.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const openAndScrollToSection = (rawHashOrId: string) => {
      const id = rawHashOrId.replace(/^#/, "");
      if (!id || !SETTINGS_SCHEMA.some((s) => s.id === id)) return;
      setOpenSections((prev) => ({ ...prev, [id]: true }));
      // Defer scroll so <details> has time to expand.
      setTimeout(() => {
        const el = document.getElementById(id);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    };

    const handleHashChange = () => openAndScrollToSection(window.location.hash);
    const handleSectionNavigate = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) openAndScrollToSection(id);
    };
    const handleExpandAll = () => {
      setOpenSections(
        Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, true])),
      );
    };
    const handleCollapseAll = () => {
      setOpenSections(
        Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, false])),
      );
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener(
      "vcontrolhub:settings-open-section",
      handleSectionNavigate,
    );
    window.addEventListener(
      "vcontrolhub:settings-expand-all",
      handleExpandAll,
    );
    window.addEventListener(
      "vcontrolhub:settings-collapse-all",
      handleCollapseAll,
    );
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener(
        "vcontrolhub:settings-open-section",
        handleSectionNavigate,
      );
      window.removeEventListener(
        "vcontrolhub:settings-expand-all",
        handleExpandAll,
      );
      window.removeEventListener(
        "vcontrolhub:settings-collapse-all",
        handleCollapseAll,
      );
    };
  }, []);

  const updateField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setSavedMessage(null);
  };
  const runtimeSummaryByKey = new Map(
    runtimeSettings.map((item) => [item.key, item]),
  );

  const handleSave = useCallback(
    async (section: SectionDef) => {
      const keys = getSectionSaveKeys(section);
      if (keys.length === 0) return;
      const validationErrors = keys
        .map((key) => {
          const field = section.fields.find((f) => f.key === key);
          if (!field?.validate) return null;
          const error = field.validate(settings[key] ?? "", settings);
          if (!error) return null;
          const label = t(field.labelKey);
          return tt(error.key, { ...error.params, label });
        })
        .filter((message): message is string => Boolean(message));
      if (validationErrors.length > 0) {
        setError(validationErrors.join("; "));
        setSaved(false);
        setSavedMessage(null);
        return;
      }
      // TR-014 M02: clear all high-risk blur warnings after a successful
      // save (the values are now persisted; warning has done its job).
      setBlurredHighRiskKeys(new Set());
      // TR-014 M01b: if any pending change in this section is high-risk,
      // show the confirm modal before performing the save.
      const pendingForSection = getPendingChanges(
        [section],
        settings,
        initialSettings,
      );
      const highChanges = pendingForSection.filter(
        (c) => c.riskLevel === "high",
      );
      const performSave = async () => {
        setSaving(true);
        setError(null);
        try {
          const payload: Record<string, string> = {};
          for (const k of keys) {
            payload[k] = settings[k] ?? "";
          }
          await csrfFetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          setSaved(true);
          setSavedMessage(
            section.saveMessageKey ? t(section.saveMessageKey) : t("settingsClient.saveSuccess"),
          );
          setTimeout(() => {
            setSaved(false);
            setSavedMessage(null);
          }, 5000);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : t("settingsClient.saveFailed"),
          );
        } finally {
          setSaving(false);
        }
      };
      if (highChanges.length > 0) {
        setHighRiskConfirm({
          changes: highChanges,
          execute: () => void performSave(),
        });
        return;
      }
      await performSave();
    },
    [settings, initialSettings, t, tt],
  );

  if (!canManage) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] p-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-sm text-[var(--text-muted)]">
          {t("settingsClient.noPermission")}
        </p>
      </div>
    );
  }

  const visibleSchema = visibleSectionIds
    ? schema.filter((s) => visibleSectionIds.includes(s.id))
    : schema;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      )}
      {saved && (
        <div
          role="status"
          className="rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--success)]"
        >
          {t("settingsClient.savedWithMessage")}
          {savedMessage ? ` — ${savedMessage}` : ""}
        </div>
      )}

      {/* Quick-jump TOC + expand/collapse all */}
      {showCategoryNav && (
        <nav
          aria-label={t("settingsClient.categoryNav")}
          className="p-4 space-y-3"
          data-card
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("settingsClient.categoryTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {t("settingsClient.categoryDescription")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                {t("settingsClient.expandAll")}
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                {t("settingsClient.collapseAll")}
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {tocItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() =>
                  setOpenSections((prev) => ({ ...prev, [item.id]: true }))
                }
                className="group flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs transition hover:border-[var(--accent-border)] hover:bg-[var(--accent-bg)]"
              >
                <span className="text-base" aria-hidden>
                  {item.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[var(--text-primary)] truncate">
                    {item.title}
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)] truncate">
                    {item.subtitle}
                  </span>
                </span>
                <span
                  className="text-[var(--accent)] opacity-0 transition group-hover:opacity-100"
                  aria-hidden
                >
                  →
                </span>
              </a>
            ))}
          </div>
        </nav>
      )}

      {visibleSchema.map((section) => (
        <SchemaDrivenSection
          key={section.id}
          section={section}
          open={openSections[section.id] ?? section.defaultOpen}
          onToggle={handleToggle(section.id)}
          settings={settings}
          initialSettings={initialSettings}
          updateField={updateField}
          runtimeSummaryByKey={runtimeSummaryByKey}
          auditMetadata={latestSectionMetadata(
            getSectionSaveKeys(section),
            settingUpdateMetadata,
          )}
          saving={saving}
          onSave={() => handleSave(section)}
          twoFactorEnabled={twoFactorEnabled}
          diffExpanded={expandedDiffs[section.id] ?? false}
          onToggleDiff={() =>
            setExpandedDiffs((prev) => ({
              ...prev,
              [section.id]: !prev[section.id],
            }))
          }
          blurredHighRiskKeys={blurredHighRiskKeys}
          onHighRiskBlur={handleHighRiskBlur}
          onHighRiskChange={clearHighRiskBlur}
        />
      ))}
      {highRiskConfirm && (
        <HighRiskConfirmModal
          changes={highRiskConfirm.changes}
          onCancel={() => setHighRiskConfirm(null)}
          onConfirm={async () => {
            const exec = highRiskConfirm.execute;
            setHighRiskConfirm(null);
            await exec();
          }}
        />
      )}
    </div>
  );
}
