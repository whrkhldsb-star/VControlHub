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
  if (field.type === "switch") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--text-secondary)]">{field.label}</span>
        <SwitchField
          label={field.label}
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
        <p className="font-medium text-amber-200">
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
      className="rounded-lg border border-rose-400/30 bg-rose-500/[0.08] px-2.5 py-1.5 text-[11px] leading-5 text-rose-100 light:border-rose-300/40 light:bg-rose-50 light:text-rose-800"
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
      className={`space-y-1.5 rounded-lg border p-3 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70 light:bg-slate-100/80"
          : "border-transparent bg-white/[0.01]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {field.label}
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
        value={normalizedValue}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(normalizedValue)}
        disabled={disabled}
        aria-describedby={describedBy}
        className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--text-muted)] light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-[var(--text-muted)]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[var(--surface)] text-[var(--text-primary)]">
            {opt.label}
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
      className={`space-y-1.5 rounded-lg border p-3 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70 light:bg-slate-100/80"
          : "border-transparent bg-white/[0.01]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {field.label}
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
        type={field.type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(value)}
        placeholder={field.placeholder}
        autoComplete={field.autoComplete}
        disabled={disabled}
        aria-describedby={describedBy}
        className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--text-muted)] disabled:placeholder:text-white/10 light:disabled:border-slate-200 light:disabled:bg-slate-100 light:disabled:text-[var(--text-muted)] light:disabled:placeholder:text-[var(--text-secondary)]"
      />
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

export function TextAreaField({
  field,
  value,
  disabled,
  helperText,
  onChange,
  showHighRiskWarning,
  onHighRiskBlur,
}: CommonProps) {
  const inputId = useId();
  const helperId = useId();
  const warningId = useId();
  return (
    <div
      className={`space-y-1.5 rounded-lg border p-3 transition ${
        disabled
          ? "border-[var(--border)] bg-[var(--surface-subtle)] opacity-70"
          : "border-transparent bg-white/[0.01]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] tracking-wide"
        >
          {field.label}
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onHighRiskBlur(value)}
        placeholder={field.placeholder}
        disabled={disabled}
        aria-describedby={
          [helperText ? helperId : null, showHighRiskWarning ? warningId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        rows={4}
        className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 disabled:cursor-not-allowed"
      />
      {showHighRiskWarning && <HighRiskBlurWarning id={warningId} />}
      {helperText && (
        <p id={helperId} className="text-xs text-[var(--text-primary)]">
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
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${value ? "bg-cyan-500" : "bg-slate-700"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : ""}`}
        />
      </button>
    </div>
  );
}
