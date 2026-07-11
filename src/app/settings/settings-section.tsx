"use client";

/**
 * Section / sub-section chrome for the settings page.
 *
 * Extracted from settings-client.tsx in R31:
 *   - `CollapsibleSection`   — the <details>+<summary> shell with icon /
 *                              title / badge / header-extra slot.
 *   - `AuditSummary`         — the small "recently updated" amber chip
 *                              shown in each section header.
 *   - `SchemaDrivenSection`  — the per-section renderer that maps a
 *                              SectionDef + current settings into a
 *                              <CollapsibleSection> containing one
 *                              <FieldRenderer> per field plus the
 *                              SaveButtonWithDiff CTA.
 *   - `formatMetadataDate` / `latestSectionMetadata` — helpers used by
 *                              both this module and the main shell.
 */
import { type ReactNode, type SyntheticEvent } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { SettingUpdateMetadata } from "@/lib/settings/service";

import {
  type BadgeTone,
  type FieldDef,
  type SectionDef,
  getSectionSaveKeys,
} from "./field-schema";
import { FieldRenderer, SwitchField } from "./settings-fields";
import {
  SaveButtonWithDiff,
  getPendingChanges,
} from "./settings-save-confirm";
import { TwoFactorSettingsLazy } from "./two-factor-settings-lazy";

export function formatMetadataDate(
  value: Date | string | null,
  t: (key: string, locale?: string) => string,
  locale: Locale = "zh",
) {
  if (!value) return t("settingsClient.metadataNoRecord");
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return t("settingsClient.metadataNoRecord");
  return date.toLocaleString(toDateLocale(locale), { hour12: false });
}

export function latestSectionMetadata(
  keys: string[],
  metadata: Record<string, SettingUpdateMetadata>,
) {
  return (
    keys
      .map((key) => metadata[key])
      .filter((item): item is SettingUpdateMetadata => Boolean(item?.updatedAt))
      .sort(
        (a, b) =>
          new Date(b.updatedAt as Date).getTime() -
          new Date(a.updatedAt as Date).getTime(),
      )[0] ?? null
  );
}

const BADGE_COLOR_CLASSES: Record<BadgeTone, string> = {
  cyan: "bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent-border)]",
  emerald: "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]",
  amber: "bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]",
  slate: "bg-[var(--surface-elevated)] text-[var(--text-muted)] border-[var(--border)]",
};

type CollapsibleSectionProps = {
  id: string;
  icon: string;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: BadgeTone;
  open: boolean;
  onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  headerExtra?: ReactNode;
  asForm?: boolean;
  children: ReactNode;
};

export function CollapsibleSection({
  id,
  icon,
  title,
  description,
  badge,
  badgeTone = "cyan",
  open,
  onToggle,
  headerExtra,
  asForm = false,
  children,
}: CollapsibleSectionProps) {
  const { t } = useI18n();
  const Inner = asForm ? "form" : "div";
  const badgeClass = BADGE_COLOR_CLASSES[badgeTone] ?? BADGE_COLOR_CLASSES.cyan;
  return (
    <section id={id} className="scroll-mt-24" data-card>
      <details open={open} onToggle={onToggle} className="group">
        <summary
          className="cursor-pointer list-none p-5 transition hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] rounded-xl"
          aria-label={`${open ? t("settingsClient.collapse") : t("settingsClient.expand")} ${title} ${t("settingsClient.sectionSuffix")}`}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-[var(--text-muted)] transition group-open:rotate-90"
              >
                ▶
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 flex-wrap">
                  <span aria-hidden>{icon}</span>
                  <span>{title}</span>
                  {badge && (
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${badgeClass}`}
                    >
                      {badge}
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
              </div>
            </div>
            {headerExtra && (
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="lg:flex-shrink-0"
              >
                {headerExtra}
              </div>
            )}
          </div>
        </summary>
        <Inner
          className="px-5 pb-5 pt-1 space-y-4"
          {...(asForm
            ? { onSubmit: (event: React.FormEvent) => event.preventDefault() }
            : {})}
        >
          {children}
        </Inner>
      </details>
    </section>
  );
}

export function AuditSummary({
  metadata,
}: {
  metadata: SettingUpdateMetadata | null;
}) {
  const { t } = useI18n();
  return (
    <div
      data-tone="amber"
      className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--warning)]"
    >
      <p className="font-semibold">{t("settingsClient.recentlyUpdated")}</p>
      <p>
        {t("settingsClient.metadataTime")}
        {formatMetadataDate(metadata?.updatedAt ?? null, t)}
      </p>
      <p>
        {t("settingsClient.metadataActor")}
        {metadata?.actorName ?? t("settingsClient.metadataNoActor")}
      </p>
    </div>
  );
}

type SchemaDrivenSectionProps = {
  section: SectionDef;
  open: boolean;
  onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  settings: Record<string, string>;
  initialSettings: Record<string, string>;
  updateField: (key: string, value: string) => void;
  runtimeSummaryByKey: Map<string, RuntimeSettingSummary>;
  auditMetadata: SettingUpdateMetadata | null;
  saving: boolean;
  onSave: () => void;
  twoFactorEnabled: boolean;
  diffExpanded: boolean;
  onToggleDiff: () => void;
  // TR-014 M02
  blurredHighRiskKeys: Set<string>;
  onHighRiskBlur: (field: FieldDef, currentValue: string) => void;
  onHighRiskChange: (field: FieldDef) => void;
};

export function SchemaDrivenSection({
  section,
  open,
  onToggle,
  settings,
  initialSettings,
  updateField,
  runtimeSummaryByKey,
  auditMetadata,
  saving,
  onSave,
  twoFactorEnabled,
  diffExpanded,
  onToggleDiff,
  blurredHighRiskKeys,
  onHighRiskBlur,
  onHighRiskChange,
}: SchemaDrivenSectionProps) {
  const { t } = useI18n();
  const saveKeys = getSectionSaveKeys(section);
  const hasSaveButton = saveKeys.length > 0;
  const descriptionKey =
    typeof section.descriptionKey === "function"
      ? section.descriptionKey(settings)
      : section.descriptionKey;
  const description = t(descriptionKey);
  const badgeKeyRaw =
    typeof section.badgeKey === "function" ? section.badgeKey(settings) : section.badgeKey;
  const badge = badgeKeyRaw ? t(badgeKeyRaw) : undefined;
  const badgeToneRaw =
    typeof section.badgeTone === "function"
      ? section.badgeTone(settings)
      : section.badgeTone;
  const badgeTone: BadgeTone = badgeToneRaw ?? "cyan";

  // SMTP's header switch lives in the headerExtra slot rather than the
  // body grid (matches the original layout).
  const headerSwitchField = section.headerSwitchKey
    ? section.fields.find((f) => f.key === section.headerSwitchKey)
    : undefined;
  const headerExtra = (
    <div className="flex flex-col gap-3 lg:items-end">
      <AuditSummary metadata={auditMetadata} />
      {headerSwitchField && (
        <SwitchField
          label={t(headerSwitchField.labelKey)}
          value={settings[headerSwitchField.key] === "true"}
          onChange={(v) =>
            updateField(headerSwitchField.key, v ? "true" : "false")
          }
        />
      )}
    </div>
  );

  return (
    <CollapsibleSection
      id={section.id}
      icon={section.icon}
      title={t(section.titleKey)}
      description={description}
      badge={
        badge ??
        (hasSaveButton
          ? `${saveKeys.length}${section.id === "runtime" ? t("settingsClient.sectionItemsSuffixAdvanced") : t("settingsClient.sectionItemsSuffix")}`
          : section.id === "2fa"
            ? "2FA"
            : undefined)
      }
      badgeTone={badgeTone}
      open={open}
      onToggle={onToggle}
      headerExtra={headerExtra}
      asForm={section.asForm}
    >
      {section.id === "2fa" ? (
        <TwoFactorSettingsLazy enabled={twoFactorEnabled} />
      ) : (
        <>
          {section.noticeBannerKey && (
            <div
              data-tone="cyan"
              className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--accent)]"
            >
              {t(section.noticeBannerKey)}
            </div>
          )}
          {(() => {
            const renderableFields = section.fields.filter(
              (f) => f.key !== section.headerSwitchKey,
            );
            const gridClass =
              section.layout === "grid-2"
                ? "grid gap-4 md:grid-cols-2"
                : "space-y-4";
            const gridAttrs =
              section.id === "smtp"
                ? { "aria-disabled": settings["smtp.enabled"] !== "true" }
                : {};
            return (
              <div className={gridClass} {...gridAttrs}>
                {renderableFields.map((field) => {
                  const helperKey =
                    typeof field.helperTextKey === "function"
                      ? field.helperTextKey(settings)
                      : field.helperTextKey;
                  const helperText = helperKey ? t(helperKey) : undefined;
                  const disabled = field.disabled
                    ? field.disabled(settings)
                    : false;
                  const value = settings[field.key] ?? field.defaultValue ?? "";
                  return (
                    <FieldRenderer
                      key={field.key}
                      field={field}
                      value={value}
                      disabled={disabled}
                      helperText={helperText}
                      onChange={(v) => {
                        updateField(field.key, v);
                        onHighRiskChange(field);
                      }}
                      runtimeSummary={runtimeSummaryByKey.get(field.key)}
                      showHighRiskWarning={blurredHighRiskKeys.has(field.key)}
                      onHighRiskBlur={(currentValue) =>
                        onHighRiskBlur(field, currentValue)
                      }
                    />
                  );
                })}
              </div>
            );
          })()}
          {hasSaveButton && (
            <SaveButtonWithDiff
              pendingChanges={getPendingChanges(
                [section],
                settings,
                initialSettings,
              )}
              expanded={diffExpanded}
              onToggleExpand={onToggleDiff}
              saving={saving}
              onClick={onSave}
            />
          )}
        </>
      )}
    </CollapsibleSection>
  );
}
