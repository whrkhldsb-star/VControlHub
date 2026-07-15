"use client";

/**
 * Settings input field renderers — Switch / Select / Input / TextArea
 * + the FieldRenderer dispatcher that picks the right variant per
 * `field.type`.
 *
 * Extracted from settings-client.tsx in R31. Each variant carries its
 * own a11y wiring (label htmlFor, helper id, runtime summary id, blur
 * warning id) so the main component stays a thin orchestrator.
 */
import { useId } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { CONTROL_CLASS, Switch } from "@/components/ui-primitives";
import type { RuntimeSettingSummaryDto as RuntimeSettingSummary } from "@/lib/runtime-settings/dto";
import type { FieldDef } from "./field-schema";
import {
  FieldRiskBadge,
  FieldRollbackButton,
} from "./settings-field-risk";

type CommonProps = {
  field: FieldDef;
  value: string;
  disabled: boolean;
  helperText: string | undefined;
  onChange: (value: string) => void;
  runtimeSummary: RuntimeSettingSummary | undefined;
  // TR-014 M02
  showHighRiskWarning: boolean;
  onHighRiskBlur: (currentValue: string) => void;
};

export type FieldRendererProps = CommonProps;

export function FieldRenderer({
  field,
  value,
  disabled,
  helperText,
  onChange,
  runtimeSummary,
  showHighRiskWarning,
  onHighRiskBlur,
}: FieldRendererProps) {
  const { t } = useI18n();
  if (field.type === "switch") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--text-secondary)]">{t(field.labelKey)}</span>
        <SwitchField
          label={t(field.labelKey)}
          riskLevel={field.riskLevel}
          value={value === "true"}
          onChange={(v) => onChange(v ? "true" : "false")}
        />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <SelectField
        field={field}
        value={value}
        disabled={disabled}
        helperText={helperText}
        onChange={onChange}
        runtimeSummary={runtimeSummary}
        showHighRiskWarning={showHighRiskWarning}
        onHighRiskBlur={onHighRiskBlur}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <TextAreaField
        field={field}
        value={value}
        disabled={disabled}
        helperText={helperText}
        onChange={onChange}
        runtimeSummary={runtimeSummary}
        showHighRiskWarning={showHighRiskWarning}
        onHighRiskBlur={onHighRiskBlur}
      />
    );
  }
  return (
    <InputField
      field={field}
      value={value}
      disabled={disabled}
      helperText={helperText}
      onChange={onChange}
      runtimeSummary={runtimeSummary}
      showHighRiskWarning={showHighRiskWarning}
      onHighRiskBlur={onHighRiskBlur}
    />
  );
}

function RuntimeSummaryPanel({
  id,
  summary,
}: {
  id: string;
  summary: RuntimeSettingSummary;
}) {
  const { t } = useI18n();
  return (
    <div
      id={id}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-2 text-[11px] leading-5 text-[var(--text-secondary)]"
    >
      <p>
        {t("settingsClient.runtimeValueLabel")}
        <strong className="text-[var(--text-primary)]">{summary.value}</strong> {summary.unit} ·{" "}
        {t("settingsClient.runtimeSourceLabel")}
        {summary.sourceLabel}
      </p>
      <p>
        {t("settingsClient.runtimeAppliesLabel")}
        {summary.applies}
      </p>
      <p>
        {t("settingsClient.runtimeEnvLabel")}
        <code>{summary.env}</code> · {t("settingsClient.runtimeRangeLabel")}
        {summary.min}–{summary.max}
        {summary.unit}
      </p>
      {summary.requiresRestart && (
        <p className="font-medium text-[var(--warning)]">
          {t("settingsClient.runtimeRestartWarning")}
        </p>
      )}
    </div>
  );
}

function HighRiskBlurWarning({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <p
      id={id}
      role="alert"
      data-testid="high-risk-blur-warning"
      className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--danger)]"
    >
      <span aria-hidden className="mr-1">
        ⚠
      </span>
      {t("settingsClient.highRiskWarning")}
    </p>
  );
}

export function SelectField({
  field,
  value,
  disabled,
  helperText,
  onChange,
  runtimeSummary,
  showHighRiskWarning,
  onHighRiskBlur,
}: CommonProps) {
  const { t } = useI18n();
  const inputId = useId();
  const helperId = useId();
  const runtimeId = useId();
  const warningId = useId();
  const describedBy =
    [
      helperText ? helperId : null,
      runtimeSummary ? runtimeId : null,
      showHighRiskWarning ? warningId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const options = field.options ?? [];
  // If the persisted value isn't one of the listed options (legacy rows,
  // custom edit), still render it as the current selection so users can
  // see and switch away.
  const normalizedValue = options.some((opt) => opt.value === value)
    ? value
    : field.defaultValue ?? options[0]?.value ?? "";
  return (
    <div
      data-form-field
      className={`space-y-1.5 rounded-xl border p-3.5 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70"
          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_55%,var(--surface))] focus-within:border-[var(--accent-border)] focus-within:bg-[var(--surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {t(field.labelKey)}
        </label>
        <FieldRiskBadge level={field.riskLevel} />
        <FieldRollbackButton
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <select
        id={inputId}
        data-input
        value={normalizedValue}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(normalizedValue)}
        disabled={disabled}
        aria-describedby={describedBy}
        className={CONTROL_CLASS}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[var(--surface)] text-[var(--text-primary)]">
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
      {showHighRiskWarning && <HighRiskBlurWarning id={warningId} />}
      {helperText && (
        <p id={helperId} className="text-xs text-[var(--text-primary)]">
          {helperText}
        </p>
      )}
      {runtimeSummary && (
        <RuntimeSummaryPanel id={runtimeId} summary={runtimeSummary} />
      )}
    </div>
  );
}

export function InputField({
  field,
  value,
  disabled,
  helperText,
  onChange,
  runtimeSummary,
  showHighRiskWarning,
  onHighRiskBlur,
}: CommonProps) {
  const { t } = useI18n();
  const inputId = useId();
  const helperId = useId();
  const runtimeId = useId();
  const warningId = useId();
  const describedBy =
    [
      helperText ? helperId : null,
      runtimeSummary ? runtimeId : null,
      showHighRiskWarning ? warningId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div
      data-form-field
      className={`space-y-1.5 rounded-xl border p-3.5 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70"
          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_55%,var(--surface))] focus-within:border-[var(--accent-border)] focus-within:bg-[var(--surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {t(field.labelKey)}
        </label>
        <FieldRiskBadge level={field.riskLevel} />
        <FieldRollbackButton
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <input
        id={inputId}
        data-input
        type={field.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(value)}
        placeholder={field.placeholderKey ? t(field.placeholderKey) : field.defaultValue ?? ""}
        autoComplete={field.autoComplete}
        disabled={disabled}
        aria-describedby={describedBy}
        className={CONTROL_CLASS}
      />
      {showHighRiskWarning && <HighRiskBlurWarning id={warningId} />}
      {helperText && (
        <p id={helperId} className="text-xs leading-5 text-[var(--text-muted)]">
          {helperText}
        </p>
      )}
      {runtimeSummary && (
        <RuntimeSummaryPanel id={runtimeId} summary={runtimeSummary} />
      )}
    </div>
  );
}

export function TextAreaField({
  field,
  value,
  disabled,
  helperText,
  onChange,
  showHighRiskWarning,
  onHighRiskBlur,
}: CommonProps) {
  const { t } = useI18n();
  const inputId = useId();
  const helperId = useId();
  const warningId = useId();
  return (
    <div
      data-form-field
      className={`space-y-1.5 rounded-xl border p-3.5 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70"
          : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-subtle)_55%,var(--surface))] focus-within:border-[var(--accent-border)] focus-within:bg-[var(--surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {t(field.labelKey)}
        </label>
        <FieldRiskBadge level={field.riskLevel} />
        <FieldRollbackButton
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <textarea
        id={inputId}
        data-input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(value)}
        placeholder={field.placeholderKey ? t(field.placeholderKey) : field.defaultValue ?? ""}
        disabled={disabled}
        aria-describedby={
          [helperText ? helperId : null, showHighRiskWarning ? warningId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        rows={4}
        className={`${CONTROL_CLASS} min-h-[6rem] resize-y`}
      />
      {showHighRiskWarning && <HighRiskBlurWarning id={warningId} />}
      {helperText && (
        <p id={helperId} className="text-xs leading-5 text-[var(--text-muted)]">
          {helperText}
        </p>
      )}
    </div>
  );
}

export function SwitchField({
  label,
  riskLevel,
  value,
  onChange,
}: {
  label: string;
  riskLevel?: "low" | "medium" | "high";
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
        {label}
        <FieldRiskBadge level={riskLevel} />
      </span>
      <Switch label={label} checked={value} onCheckedChange={onChange} />
    </div>
  );
}
