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
import { useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import type { FieldType, SectionDef } from "./field-schema";
import { FieldRiskBadge } from "./settings-field-risk";
import { ActionButton } from "@/components/action-button";

import { IconChevronDown } from "@/components/nav-icons";
import { Dialog } from "@/components/ui/dialog";
import { AlertTriangle } from "@/components/icons";
// TR-014 M01b
export type PendingChange = {
  key: string;
  labelKey: string;
  oldValue: string;
  newValue: string;
  riskLevel: "low" | "medium" | "high";
  sectionId: string;
  fieldType: FieldType;
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
        labelKey: field.labelKey,
        oldValue,
        newValue,
        riskLevel: field.riskLevel ?? "low",
        sectionId: section.id,
        fieldType: field.type,
      });
    }
  }
  return out;
}

/** Truncate + display-safe a value for the diff table. Empty strings
 * display as the localized "（空）" sentinel so it's never blank.
 * Password fields are redacted so secrets never paint into the DOM. */
export function renderDiffValue(
  value: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
  max = 60,
  fieldType?: FieldType,
): string {
  if (value === "") return t("settingsClient.emptyValue");
  if (fieldType === "password") return t("settingsClient.maskedSecret");
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
          <ActionButton
            size="xs"
            variant={highCount > 0 ? "danger" : mediumCount > 0 ? "warning" : "secondary"}
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={t("settingsClient.expandAria", { count, expanded: expanded ? t("settingsClient.collapsed") : t("settingsClient.expanded") })}
            data-pending-count={count}
            iconRight={<IconChevronDown aria-hidden className={expanded ? "rotate-180" : undefined} />}
          >
            <span>
              {count > 0
                ? (() => {
                    if (highCount > 0)
                      return t("settingsClient.changesCountHighRisk", { count, high: highCount });
                    if (mediumCount > 0)
                      return t("settingsClient.changesCountMediumRisk", { count, medium: mediumCount });
                    return t("settingsClient.changesCount", { count });
                  })()
                : ""}
            </span>
          </ActionButton>
        )}
        <ActionButton variant={highCount > 0 ? "danger" : "primary"}
          onClick={onClick}
          disabled={saving}
          data-component="save-button">
          {saving ? t("settingsClient.saving") : t("settingsClient.save")}
        </ActionButton>
      </div>
      {expanded && count > 0 && (
        <div data-inset=""
          data-component="diff-table"
          role="region"
          aria-label={t("settingsPage.unsavedChangesAria")}
          className="overflow-hidden"
        >
          <table className="w-full text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-left text-xs uppercase text-[var(--text-muted)] light:bg-[var(--surface)]/70">
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
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{t(change.labelKey)}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)] line-through">
                    {renderDiffValue(change.oldValue, t, 60, change.fieldType)}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-primary)] light:text-[var(--accent)]">
                    {renderDiffValue(change.newValue, t, 60, change.fieldType)}
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
 * Pre-save confirmation dialog — shown only when at least one queued change
 * has riskLevel === "high".
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
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      size="lg"
      role="alertdialog"
      onClose={onCancel}
      busy={busy}
      icon={<AlertTriangle className="text-[var(--danger)]" />}
      title={t("settingsClient.confirmHighRiskTitle")}
      description={t("settingsClient.confirmHighRiskDescription", { count: changes.length })}
      panelProps={{ "data-component": "high-risk-confirm-modal", "data-testid": "high-risk-confirm-modal" }}
      footer={<>
        <ActionButton variant="secondary" onClick={onCancel} disabled={busy} data-action="cancel">
          {t("settingsClient.confirmCancel")}
        </ActionButton>
        <ActionButton
          variant="danger-solid"
          loading={busy}
          data-action="confirm"
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("settingsClient.saving") : t("settingsClient.confirmSaveAction")}
        </ActionButton>
      </>}
    >
      <ul className="space-y-2">
        {changes.map((change) => (
          <li key={change.key} data-inset="" className="border-[var(--danger-border)] p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-[var(--text-primary)]">{t(change.labelKey)}</span>
              <FieldRiskBadge level={change.riskLevel} />
            </div>
            <div className="mt-1.5 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              <div>
                <span className="text-[var(--text-muted)]">{t("settingsClient.confirmOriginal")}</span>
                <span className="text-[var(--text-secondary)] line-through">
                  {renderDiffValue(change.oldValue, t, 40, change.fieldType)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">{t("settingsClient.confirmNew")}</span>
                <span className="text-[var(--danger)]">
                  {renderDiffValue(change.newValue, t, 40, change.fieldType)}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
