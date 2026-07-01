"use client";

/**
 * Field-level risk chrome — chip + rollback button used by every input
 * variant in the settings page (R31 split from settings-client.tsx).
 *
 * `FieldRiskBadge`     — small ⚠ badge shown next to the field label
 *                        when riskLevel is "medium" or "high".
 * `FieldRollbackButton`— per-field ↺ button that resets the field to
 *                        its `defaultValue`. Hidden for password fields
 *                        unless explicitly `rollbackable: true`.
 *
 * Both helpers are re-exported from `settings-client.tsx` so existing
 * test imports (`@/app/settings/settings-client`) keep working.
 */
import type { FieldDef } from "./field-schema";
import { useI18n } from "@/lib/i18n/use-locale";

/**
 * Risk-level badge (medium / high only). Renders nothing for "low" or
 * undefined — most fields shouldn't distract the user.
 *
 * The visible-text label is sr-only because testing-library
 * `getByLabelText` defaults to exact=true, and sibling text would make
 * it fail; the chip color + ⚠ icon carry the visual signal.
 */
export function FieldRiskBadge({
  level,
}: {
  level: "low" | "medium" | "high" | undefined;
}) {
  const { t } = useI18n();
  if (!level || level === "low") return null;
  const className =
    level === "high"
      ? "inline-flex items-center gap-0.5 rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-200 light:border-rose-700/25 light:bg-rose-50 light:text-rose-800"
      : "inline-flex items-center gap-0.5 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200 light:border-amber-700/25 light:bg-amber-50 light:text-amber-800";
  const label =
    level === "high"
      ? t("settingsClient.riskHigh")
      : t("settingsClient.riskMedium");
  const description =
    level === "high"
      ? t("settingsClient.riskHighDescription")
      : t("settingsClient.riskMediumDescription");
  return (
    <span data-risk={level} title={description} aria-label={label} className={className}>
      <span aria-hidden>⚠</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Per-field "restore default" button.
 * - Rendered only when `field.defaultValue` is set and field is not a
 *   password (unless the field opts in with `rollbackable: true`).
 * - Disabled when current value equals defaultValue or is empty.
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
  const supportsRollback =
    field.rollbackable !== false &&
    field.defaultValue !== undefined &&
    field.type !== "password";
  if (!supportsRollback) return null;
  const isAtDefault = value === field.defaultValue || value === "";
  return (
    <button
      type="button"
      onClick={() => onChange(field.defaultValue ?? "")}
      disabled={disabled || isAtDefault}
      title={
        isAtDefault
          ? t("settingsClient.fieldIsDefault")
          : t("settingsClient.fieldRestoreDefault").replace(
              "{value}",
              field.defaultValue ?? "",
            )
      }
      aria-label={t("settingsClient.fieldRestoreAria").replace(
        "{label}",
        field.label,
      )}
      className="inline-flex items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--surface)]/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.10] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40 light:bg-slate-50 light:hover:border-cyan-500/40 light:hover:text-cyan-700"
    >
      <span aria-hidden>↺</span>
      <span className="sr-only">{t("settingsClient.fieldDefaultSr")}</span>
    </button>
  );
}
