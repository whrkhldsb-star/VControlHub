"use client";

/**
 * Pending-change tooling for the settings page (R31 split from
 * settings-client.tsx).
 *
 * Public surface:
 *   - `PendingChange` type
 *   - `getPendingChanges` — diff helper used by both the inline diff
 *     badge and the high-risk confirm modal.
 *   - `renderDiffValue` — shared value truncator/escape for diff cells.
 *   - `SaveButtonWithDiff` — the "Save" CTA + collapsible diff table.
 *   - `HighRiskConfirmModal` — `<dialog>` second-confirm before
 *     persisting any `high` risk change.
 */
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import type { SectionDef } from "./field-schema";
import { FieldRiskBadge } from "./settings-field-risk";

// TR-014 M01b
export type PendingChange = {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  riskLevel: "low" | "medium" | "high";
  sectionId: string;
};

/** Diff current settings against the initial snapshot, returning only
 * fields whose value changed, in section order. */
export function getPendingChanges(
  sections: SectionDef[],
  settings: Record<string, string>,
  initialSettings: Record<string, string>,
): PendingChange[] {
  const out: PendingChange[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      const newValue = settings[field.key] ?? "";
      const oldValue = initialSettings[field.key] ?? "";
      if (newValue === oldValue) continue;
      out.push({
        key: field.key,
        label: field.label,
        oldValue,
        newValue,
        riskLevel: field.riskLevel ?? "low",
        sectionId: section.id,
      });
    }
  }
  return out;
}

/** Truncate + display-safe a value for the diff table. Empty strings
 * display as the localized "（空）" sentinel so it's never blank. */
export function renderDiffValue(
  value: string,
  t: (key: string) => string,
  max = 60,
): string {
  if (value === "") return t("settingsClient.emptyValue");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * Save CTA combined with the inline diff table.
 *
 * - Shows a pill with the pending-change count (color tinted by the
 *   highest risk level — rose/amber/cyan).
 * - Clicking the pill toggles an inline diff table (field / before /
 *   after / risk).
 * - The "Save" button is always visible; its color flips to rose when
 *   any high-risk change is queued.
 */
export function SaveButtonWithDiff({
  pendingChanges,
  expanded,
  onToggleExpand,
  saving,
  onClick,
}: {
  pendingChanges: PendingChange[];
  expanded: boolean;
  onToggleExpand: () => void;
  saving: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const count = pendingChanges.length;
  const highCount = pendingChanges.filter((c) => c.riskLevel === "high").length;
  const mediumCount = pendingChanges.filter((c) => c.riskLevel === "medium").length;
  return (
    <div className="pt-2 space-y-2" data-component="save-button-with-diff">
      <div className="flex flex-wrap items-center gap-2">
        {count > 0 && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={t("settingsClient.expandAria")
              .replace("{count}", String(count))
              .replace(
                "{expanded}",
                expanded ? t("settingsClient.collapsed") : t("settingsClient.expanded"),
              )}
            data-pending-count={count}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
              highCount > 0
                ? "border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15 light:border-rose-700/30 light:bg-rose-50 light:text-rose-800"
                : mediumCount > 0
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15 light:border-amber-700/30 light:bg-amber-50 light:text-amber-800"
                  : "border-cyan-400/30 bg-cyan-400/10 text-[var(--text-secondary)] hover:bg-cyan-400/15 light:border-cyan-700/30 light:bg-cyan-50 light:text-cyan-800"
            }`}
          >
            <span aria-hidden>{expanded ? "▾" : "▸"}</span>
            <span>
              {count > 0
                ? (() => {
                    if (highCount > 0)
                      return t("settingsClient.changesCountHighRisk")
                        .replace("{count}", String(count))
                        .replace("{high}", String(highCount));
                    if (mediumCount > 0)
                      return t("settingsClient.changesCountMediumRisk")
                        .replace("{count}", String(count))
                        .replace("{medium}", String(mediumCount));
                    return t("settingsClient.changesCount").replace(
                      "{count}",
                      String(count),
                    );
                  })()
                : ""}
            </span>
          </button>
        )}
        <button
          onClick={onClick}
          disabled={saving}
          data-component="save-button"
          className={`rounded-2xl px-5 py-2 text-sm font-medium transition disabled:opacity-60 ${
            highCount > 0
              ? "bg-rose-500 text-[var(--text-primary)] hover:bg-rose-400 light:bg-rose-600 light:hover:bg-rose-500"
              : "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          }`}
        >
          {saving ? t("settingsClient.saving") : t("settingsClient.save")}
        </button>
      </div>
      {expanded && count > 0 && (
        <div
          data-component="diff-table"
          role="region"
          aria-label="未保存的修改"
          className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.02] light:bg-slate-50"
        >
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface)]/[0.02] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] light:bg-slate-100/70">
              <tr>
                <th className="px-3 py-2 font-medium">{t("settingsClient.diffTableField")}</th>
                <th className="px-3 py-2 font-medium">{t("settingsClient.diffTableOriginal")}</th>
                <th className="px-3 py-2 font-medium">{t("settingsClient.diffTableNew")}</th>
                <th className="px-3 py-2 font-medium">{t("settingsClient.diffTableRisk")}</th>
              </tr>
            </thead>
            <tbody>
              {pendingChanges.map((change) => (
                <tr
                  key={change.key}
                  data-pending-key={change.key}
                  data-pending-risk={change.riskLevel}
                  className="border-t border-[var(--border)] align-top"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-primary)]">{change.label}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)] line-through">
                    {renderDiffValue(change.oldValue, t)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-primary)] light:text-cyan-800">
                    {renderDiffValue(change.newValue, t)}
                  </td>
                  <td className="px-3 py-2">
                    <FieldRiskBadge level={change.riskLevel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Pre-save confirmation modal — shown only when at least one queued
 * change has riskLevel === "high". Uses native <dialog> for ESC + auto
 * backdrop; falls back to manual `open` in jsdom (no showModal).
 */
export function HighRiskConfirmModal({
  changes,
  onCancel,
  onConfirm,
}: {
  changes: PendingChange[];
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom test env doesn't implement HTMLDialogElement.showModal
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else if (!dialog.open) {
      dialog.open = true;
    }
    const handleClose = () => onCancel();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onCancel]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="high-risk-confirm-title"
      data-component="high-risk-confirm-modal"
      data-testid="high-risk-confirm-modal"
      className="rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-0 text-[var(--text-primary)] shadow-2xl backdrop:bg-[var(--surface)]/70 light:backdrop:bg-[var(--surface)]"
    >
      <div className="w-[min(560px,90vw)] p-5">
        <h2
          id="high-risk-confirm-title"
          className="text-base font-semibold text-rose-200 light:text-rose-700"
        >
          {t("settingsClient.confirmHighRiskTitle")}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("settingsClient.confirmHighRiskDescription").replace(
            "{count}",
            String(changes.length),
          )}
        </p>
        <ul className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
          {changes.map((change) => (
            <li
              key={change.key}
              className="rounded-lg border border-rose-400/20 bg-rose-500/[0.06] p-3 text-xs light:border-rose-200 light:bg-rose-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-[var(--text-primary)]">{change.label}</span>
                <FieldRiskBadge level={change.riskLevel} />
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
                <div>
                  <span className="text-[var(--text-muted)]">{t("settingsClient.confirmOriginal")}</span>
                  <span className="text-[var(--text-secondary)] line-through">
                    {renderDiffValue(change.oldValue, t, 40)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">{t("settingsClient.confirmNew")}</span>
                  <span className="text-rose-100 light:text-rose-800">
                    {renderDiffValue(change.newValue, t, 40)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-action="cancel"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.02] px-4 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.05] hover:text-[var(--text-primary)] disabled:opacity-50 light:text-slate-700 light:hover:bg-slate-50"
          >
            {t("settingsClient.confirmCancel")}
          </button>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            data-action="confirm"
            className="rounded-lg bg-rose-500 px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-rose-400 disabled:opacity-50 light:bg-rose-600 light:hover:bg-rose-500"
          >
            {busy ? t("settingsClient.saving") : t("settingsClient.confirmSaveAction")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
