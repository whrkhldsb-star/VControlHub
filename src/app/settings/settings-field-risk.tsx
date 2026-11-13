"use client";

/**
 * Field-level risk chrome of the settings page: the risk badge next to a field's label and the
 * "restore default" button.
 *
 * Both are re-exported from `settings-client.tsx`, where the tests import them from.
 */
import { ActionButton } from "@/components/action-button";
import { AlertTriangle, RotateCcw } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";

import type { FieldDef } from "./field-schema";

/**
 * Risk badge for "medium" and "high"; nothing for "low" or no level, so most fields stay quiet.
 *
 * The label is read by screen readers only (the badge is an icon in the level's colour): as visible text
 * next to the field's label it would become part of that label's text.
 */
export function FieldRiskBadge({ level }: { level: "low" | "medium" | "high" | undefined }) {
  const { t } = useI18n();
  if (!level || level === "low") return null;
  const high = level === "high";
  const label = t(high ? "settingsClient.riskHigh" : "settingsClient.riskMedium");
  return (
    <span
      data-risk={level}
      title={t(high ? "settingsClient.riskHighDescription" : "settingsClient.riskMediumDescription")}
      aria-label={label}
      className={cn(
        "inline-flex items-center rounded border px-1 py-0.5",
        high
          ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
          : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
      )}
    >
      <AlertTriangle size={12} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Puts a field back to its default. Shown when the field has a default and is not a password (a field can
 * opt out with `rollbackable: false`); disabled while the value is the default or empty.
 */
export function FieldRollbackButton({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const supportsRollback = field.rollbackable !== false && field.defaultValue !== undefined && field.type !== "password";
  if (!supportsRollback) return null;
  const isAtDefault = value === field.defaultValue || value === "";
  return (
    <ActionButton
      size="xs"
      variant="ghost"
      square
      onClick={() => onChange(field.defaultValue ?? "")}
      disabled={disabled || isAtDefault}
      title={isAtDefault ? t("settingsClient.fieldIsDefault") : t("settingsClient.fieldRestoreDefault", { value: field.defaultValue ?? "" })}
      aria-label={t("settingsClient.fieldRestoreAria", { label: t(field.labelKey) })}
    >
      <RotateCcw size={14} aria-hidden />
      <span className="sr-only">{t("settingsClient.fieldDefaultSr")}</span>
    </ActionButton>
  );
}
