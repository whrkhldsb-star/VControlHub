"use client";

import { useCallback, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState, Toolbar, SurfacePanel, ListPanel } from "@/components/page-shell";
import { File as FileIcon } from "@/components/icons";
import { statusLabelFor, dryRunStepCounts } from "./playbook-types";
import type { SerializedPlaybook, RunSummary, ServerOption } from "./playbook-types";
import { CreatePlaybookForm } from "./create-playbook-form";
import { PlaybookCard } from "./playbook-card";
import { PlaybookDeleteDialog } from "./playbook-delete-dialog";

type Props = {
  playbooks: SerializedPlaybook[];
  runsByPlaybook: Record<string, RunSummary[]>;
  servers: ServerOption[];
  canManage: boolean;
  canRun: boolean;
};

export function PlaybookListClient({
  playbooks: initial,
  runsByPlaybook: initialRuns,
  servers,
  canManage,
  canRun,
}: Props) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [playbooks, setPlaybooks] = useState(initial);
  const [runsByPlaybook, setRunsByPlaybook] = useState(initialRuns);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SerializedPlaybook | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshRuns = useCallback(async (playbookId: string) => {
    const data = await csrfFetch<{ runs: RunSummary[] }>(`/api/playbooks/${playbookId}/runs`);
    setRunsByPlaybook((prev) => ({ ...prev, [playbookId]: data.runs ?? [] }));
  }, []);

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
        if (run.status === "queued" || run.status === "running") {
          // Durable worker finishes asynchronously; poll a few times for step progress.
          window.setTimeout(() => { void refreshRuns(id); }, 2_000);
          window.setTimeout(() => { void refreshRuns(id); }, 6_000);
          window.setTimeout(() => { void refreshRuns(id); }, 15_000);
        }
        if (kind === "dry-run") {
          if (run.status === "queued" || run.status === "running") {
            addToast("success", t("playbooksPage.toast.dryRunQueued"));
          } else if (run.status === "failed" || run.status === "cancelled") {
            // Do not celebrate a failed/cancelled dry-run as success (false-success UX).
            addToast(
              "error",
              t("playbooksPage.toast.run").replace("{status}", statusLabelFor(t, run.status)),
            );
          } else {
            const counts = dryRunStepCounts(run);
            addToast(
              "success",
              t("playbooksPage.toast.dryRun")
                .replace("{ok}", String(counts.ok))
                .replace("{total}", String(counts.total)),
            );
          }
        } else if (run.status === "queued" || run.status === "running") {
          addToast(
            "success",
            t("playbooksPage.toast.runQueued").replace("{status}", statusLabelFor(t, run.status)),
          );
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
    [addToast, refreshRuns, t],
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
      <Toolbar className="justify-end">
        {canManage && !showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            data-primary
            data-action-button data-variant="primary" className="min-h-11 px-5 py-2.5 text-sm"
          >
            {t("playbooksPage.action.create")}
          </button>
        )}
      </Toolbar>

      {showCreate && (
        <SurfacePanel title={t("playbooksPage.action.create")}>
          <CreatePlaybookForm servers={servers} onClose={() => { setShowCreate(false); void refresh(); }} />
        </SurfacePanel>
      )}

      <ListPanel
        title={t("playbooksPage.title")}
        count={playbooks.length}
        empty={
          playbooks.length === 0 ? (
            <EmptyState icon={<FileIcon size={32} className="text-[var(--text-muted)]" />} variant="boxed">
              <div className="space-y-2">
                <p>{t("playbooksPage.empty")}</p>
                <p className="text-xs text-[var(--text-muted)]">{t("playbooksPage.emptyHint")}</p>
                {canManage && !showCreate && (
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    data-action-button
                    data-variant="primary"
                    className="!mt-2 !min-h-9 !px-4 !py-2 !text-sm"
                  >
                    {t("playbooksPage.action.create")}
                  </button>
                )}
              </div>
            </EmptyState>
          ) : undefined
        }
        bodyClassName={playbooks.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
      >
        {playbooks.map((playbook) => (
          <div key={playbook.id} className="mb-3 last:mb-0">
            <PlaybookCard
              playbook={playbook}
              runs={runsByPlaybook[playbook.id]}
              canRun={canRun}
              canManage={canManage}
              busyAction={busyAction}
              onTrigger={handleTrigger}
              onToggle={handleToggle}
              onDelete={setPendingDelete}
            />
          </div>
        ))}
      </ListPanel>

      <PlaybookDeleteDialog
        playbook={pendingDelete}
        busy={pendingDelete ? busyAction === `delete:${pendingDelete.id}` : false}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
      />
    </div>
  );
}
