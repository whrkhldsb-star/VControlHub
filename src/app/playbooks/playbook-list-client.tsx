"use client";

import { useCallback, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState } from "@/components/page-shell";
import { File as FileIcon } from "@/components/icons";
import { statusLabelFor, dryRunStepCounts } from "./playbook-types";
import type { SerializedPlaybook, RunSummary } from "./playbook-types";
import { CreatePlaybookForm } from "./create-playbook-form";
import { PlaybookCard } from "./playbook-card";
import { PlaybookDeleteDialog } from "./playbook-delete-dialog";

type Props = {
  playbooks: SerializedPlaybook[];
  runsByPlaybook: Record<string, RunSummary[]>;
  canManage: boolean;
  canRun: boolean;
};

export function PlaybookListClient({ playbooks: initial, runsByPlaybook: initialRuns, canManage, canRun }: Props) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [playbooks, setPlaybooks] = useState(initial);
  const [runsByPlaybook, setRunsByPlaybook] = useState(initialRuns);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SerializedPlaybook | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await csrfFetch<{ playbooks: SerializedPlaybook[] }>("/api/playbooks");
    setPlaybooks(data.playbooks ?? []);
  }, []);

  const handleTrigger = useCallback(
    async (id: string, kind: "run" | "dry-run") => {
      setActionError(null);
      setBusyAction(`${kind}:${id}`);
      try {
        const result = await csrfFetch<{ run: RunSummary }>(`/api/playbooks/${id}/${kind}`, { method: "POST" });
        const run = result.run;
        setRunsByPlaybook((prev) => ({
          ...prev,
          [id]: [run, ...(prev[id] ?? [])].slice(0, 5),
        }));
        if (kind === "dry-run") {
          const counts = dryRunStepCounts(run);
          addToast("success", t("playbooksPage.toast.dryRun").replace("{ok}", String(counts.ok)).replace("{total}", String(counts.total)));
        } else {
          addToast(
            run.status === "failed" ? "error" : "success",
            t("playbooksPage.toast.run").replace("{status}", statusLabelFor(t, run.status)),
          );
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t("playbooksPage.error.load"));
      } finally {
        setBusyAction(null);
      }
    },
    [addToast, t],
  );

  const handleToggle = useCallback(
    async (playbook: SerializedPlaybook) => {
      setActionError(null);
      setBusyAction(`toggle:${playbook.id}`);
      try {
        await csrfFetch(`/api/playbooks/${playbook.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: playbook.id, enabled: !playbook.enabled }),
        });
        addToast("success", t("playbooksPage.toast.toggled"));
        void refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t("playbooksPage.error.toggle"));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, t, addToast],
  );

  const handleDelete = useCallback(
    async (playbook: SerializedPlaybook) => {
      setActionError(null);
      setBusyAction(`delete:${playbook.id}`);
      try {
        await csrfFetch(`/api/playbooks/${playbook.id}`, { method: "DELETE" });
        setPendingDelete(null);
        addToast("success", t("playbooksPage.toast.deleted"));
        void refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t("playbooksPage.error.delete"));
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, t, addToast],
  );

  return (
    <div className="space-y-6">
      {actionError && (
        <div role="alert" className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
          {actionError}
        </div>
      )}
      <div className="flex justify-end">
        {canManage && !showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            data-tone="accent"
            className="min-h-11 rounded-2xl border px-5 py-2.5 text-sm font-medium transition"
          >
            {t("playbooksPage.action.create")}
          </button>
        )}
      </div>

      {showCreate && <CreatePlaybookForm onClose={() => { setShowCreate(false); void refresh(); }} />}

      {playbooks.length === 0 ? (
        <EmptyState icon={<FileIcon size={48} className="text-[var(--text-muted)]" />} variant="boxed">
          <p>{t("playbooksPage.empty")}</p>
          {canManage && !showCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              data-tone="accent"
              className="mt-4 min-h-9 rounded-xl border px-4 py-2 text-sm font-medium transition-colors"
            >
              {t("playbooksPage.action.create")}
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {playbooks.map((playbook) => (
            <PlaybookCard
              key={playbook.id}
              playbook={playbook}
              runs={runsByPlaybook[playbook.id]}
              canRun={canRun}
              canManage={canManage}
              busyAction={busyAction}
              onTrigger={handleTrigger}
              onToggle={handleToggle}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <PlaybookDeleteDialog
        playbook={pendingDelete}
        busy={pendingDelete ? busyAction === `delete:${pendingDelete.id}` : false}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
      />
    </div>
  );
}
