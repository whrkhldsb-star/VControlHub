"use client";

import { memo } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { statusLabelFor, formatTime } from "./playbook-types";
import type { SerializedPlaybook, RunSummary } from "./playbook-types";

type PlaybookRunHistoryProps = {
  runs: RunSummary[];
  t: (k: string) => string;
};

export function PlaybookRunHistory({ runs, t }: PlaybookRunHistoryProps) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        {t("playbooksPage.runHistory").replace("{count}", String(runs.length))}
      </summary>
      <div className="mt-2 space-y-1.5">
        {runs.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">{t("playbooksPage.runHistory.empty")}</p>
        ) : (
          runs.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span data-tone={r.status === "failed" ? "danger" : r.status === "completed" ? "success" : "neutral"} className="rounded-full border px-1.5 py-0.5 text-[10px]">
                {statusLabelFor(t, r.status)}{r.dryRun ? " · dry-run" : ""}
              </span>
              <span className="text-[var(--text-muted)]">{formatTime(r.startedAt)}</span>
              {r.errorMessage && <span className="text-[var(--danger)] truncate">{r.errorMessage}</span>}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

type PlaybookCardProps = {
  playbook: SerializedPlaybook;
  runs: RunSummary[] | undefined;
  canRun: boolean;
  canManage: boolean;
  busyAction: string | null;
  onTrigger: (id: string, kind: "run" | "dry-run") => void;
  onToggle: (playbook: SerializedPlaybook) => void;
  onDelete: (playbook: SerializedPlaybook) => void;
};

export const PlaybookCard = memo(function PlaybookCard({
  playbook,
  runs,
  canRun,
  canManage,
  busyAction,
  onTrigger,
  onToggle,
  onDelete,
}: PlaybookCardProps) {
  const { t } = useI18n();
  const isRunning = busyAction === `run:${playbook.id}`;
  const isDryRunning = busyAction === `dry-run:${playbook.id}`;
  const isToggling = busyAction === `toggle:${playbook.id}`;
  const isDeleting = busyAction === `delete:${playbook.id}`;
  const playbookRuns = runs ?? [];

  return (
    <article data-card className="hover:bg-[var(--surface-elevated)] transition-colors duration-150">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{playbook.name}</h2>
            <span
              data-tone={playbook.enabled ? "success" : "neutral"}
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
            >
              {playbook.enabled ? t("playbooksPage.status.enabled") : t("playbooksPage.status.disabled")}
            </span>
            <span data-tone="cyan" className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium">
              {playbook.triggerType}
            </span>
          </div>
          {playbook.description && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{playbook.description}</p>
          )}
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            {t("playbooksPage.stepsAndCreatedAt").replace("{count}", String(playbook.steps.length)).replace("{time}", formatTime(playbook.createdAt))}
          </div>
          <PlaybookRunHistory runs={playbookRuns} t={t} />
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          {canRun && (
            <>
              <button
                type="button"
                onClick={() => onTrigger(playbook.id, "dry-run")}
                disabled={isDryRunning || isRunning}
                data-tone="accent"
                className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
              >
                {isDryRunning ? t("playbooksPage.action.dryRunRunning") : t("playbooksPage.action.dryRun")}
              </button>
              <button
                type="button"
                onClick={() => onTrigger(playbook.id, "run")}
                disabled={!playbook.enabled || isRunning || isDryRunning}
                data-tone="accent"
                className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
              >
                {isRunning ? t("playbooksPage.action.running") : t("playbooksPage.action.run")}
              </button>
            </>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => onToggle(playbook)}
              disabled={isToggling}
              data-tone="warn"
              className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
            >
              {isToggling ? t("playbooksPage.action.toggling") : t("playbooksPage.action.toggle")}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => onDelete(playbook)}
              disabled={isDeleting}
              data-tone="danger"
              className="min-h-11 rounded-2xl border px-4 py-2 text-xs font-medium transition disabled:opacity-50"
            >
              {isDeleting ? t("playbooksPage.action.deleting") : t("playbooksPage.action.delete")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}, (prev, next) =>
  prev.playbook === next.playbook
  && prev.runs === next.runs
  && prev.canRun === next.canRun
  && prev.canManage === next.canManage
  && prev.busyAction === next.busyAction
  && prev.onTrigger === next.onTrigger
  && prev.onToggle === next.onToggle
  && prev.onDelete === next.onDelete
);
