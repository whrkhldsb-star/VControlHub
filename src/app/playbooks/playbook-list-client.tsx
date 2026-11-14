"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState, ListPanel, PageHeader, SurfacePanel } from "@/components/page-shell";
import { File as FileIcon, Plus } from "@/components/icons";
import { statusLabelFor, dryRunStepCounts } from "./playbook-types";
import type { SerializedPlaybook, RunSummary, ServerOption } from "./playbook-types";
import { PlaybookForm } from "./playbook-form";
import { PlaybookCard } from "./playbook-card";
import { PlaybookDeleteDialog } from "./playbook-delete-dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { PaginatedList } from "@/components/paginated-list";

const RUN_POLL_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000, 240_000, 300_000] as const;

type Props = {
  /** Page header; rendered here so the create command sits in its actions. */
  header?: { eyebrow?: string; title: string; description?: string };
  playbooks: SerializedPlaybook[];
  runsByPlaybook: Record<string, RunSummary[]>;
  servers: ServerOption[];
  canManage: boolean;
  canRun: boolean;
};

export function PlaybookListClient({
  header,
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
  // The playbook whose changes the form holds; null while it makes a new one.
  const [editing, setEditing] = useState<SerializedPlaybook | null>(null);
  const formPanelRef = useRef<HTMLDivElement>(null);
  const [pendingDelete, setPendingDelete] = useState<SerializedPlaybook | null>(null);
  // A refused deletion is said in its dialog; every other action answers with a toast, where the click was.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refreshRuns = useCallback(async (playbookId: string) => {
    const data = await csrfFetch<{ runs: RunSummary[] }>(`/api/playbooks/${playbookId}/runs`);
    setRunsByPlaybook((prev) => ({ ...prev, [playbookId]: data.runs ?? [] }));
    return data.runs ?? [];
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await csrfFetch<{ playbooks: SerializedPlaybook[] }>("/api/playbooks");
      setPlaybooks(data.playbooks ?? []);
    } catch (err) {
      // The action itself went through; only the list could not be read again.
      addToast("error", getErrorMessage(err, t("playbooksPage.error.load")));
    }
  }, [addToast, t]);


  const runPollTimersRef = useRef<Map<string, number>>(new Map());

  const clearRunPolling = useCallback((playbookId?: string) => {
    const map = runPollTimersRef.current;
    if (playbookId) {
      const timer = map.get(playbookId);
      if (timer !== undefined) window.clearTimeout(timer);
      map.delete(playbookId);
      return;
    }
    for (const timer of map.values()) window.clearTimeout(timer);
    map.clear();
  }, []);

  useEffect(() => () => clearRunPolling(), [clearRunPolling]);

  const isTerminalRunStatus = useCallback((status: string) => {
    return status === "completed" || status === "failed" || status === "cancelled";
  }, []);

  const startRunPolling = useCallback(
    (playbookId: string) => {
      clearRunPolling(playbookId);
      let attempt = 0;

      const scheduleNext = () => {
        if (attempt >= RUN_POLL_DELAYS_MS.length) {
          clearRunPolling(playbookId);
          return;
        }
        const delay = RUN_POLL_DELAYS_MS[attempt];
        attempt += 1;
        const timer = window.setTimeout(() => {
          void refreshRuns(playbookId)
            .then((runs) => {
              const latest = runs[0];
              if (latest && isTerminalRunStatus(latest.status)) {
                clearRunPolling(playbookId);
                return;
              }
              scheduleNext();
            })
            .catch(() => {
              scheduleNext();
            });
        }, delay);
        runPollTimersRef.current.set(playbookId, timer);
      };

      scheduleNext();
    },
    [clearRunPolling, isTerminalRunStatus, refreshRuns],
  );

  const handleTrigger = useCallback(
    async (id: string, kind: "run" | "dry-run") => {
      const actionKey = `${kind}:${id}`;
      setBusyAction(actionKey);
      try {
        const result = await csrfFetch<{ run: RunSummary }>(`/api/playbooks/${id}/${kind}`, { method: "POST" });
        const run = result.run;
        setRunsByPlaybook((prev) => ({
          ...prev,
          [id]: [run, ...(prev[id] ?? [])].slice(0, 5),
        }));
        if (run.status === "queued" || run.status === "running") {
          // Durable worker finishes asynchronously; poll until terminal or max window.
          startRunPolling(id);
        }
        if (kind === "dry-run") {
          if (run.status === "queued" || run.status === "running") {
            addToast("success", t("playbooksPage.toast.dryRunQueued"));
          } else if (run.status === "failed" || run.status === "cancelled") {
            // Do not celebrate a failed/cancelled dry-run as success (false-success UX).
            addToast(
              "error",
              t("playbooksPage.toast.run", { status: statusLabelFor(t, run.status) }),
            );
          } else {
            const counts = dryRunStepCounts(run);
            addToast(
              "success",
              t("playbooksPage.toast.dryRun", { ok: counts.ok, total: counts.total }),
            );
          }
        } else if (run.status === "queued" || run.status === "running") {
          addToast(
            "success",
            t("playbooksPage.toast.runQueued", { status: statusLabelFor(t, run.status) }),
          );
        } else {
          addToast(
            run.status === "failed" ? "error" : "success",
            t("playbooksPage.toast.run", { status: statusLabelFor(t, run.status) }),
          );
        }
      } catch (err) {
        addToast("error", getErrorMessage(err, t(kind === "dry-run" ? "playbooksPage.error.dryRun" : "playbooksPage.error.run")));
      } finally {
        setBusyAction((prev) => (prev === actionKey ? null : prev));
      }
    },
    [addToast, startRunPolling, t],
  );

  const handleEdit = useCallback((target: SerializedPlaybook) => {
    setEditing(target);
    setShowCreate(true);
  }, []);

  // The form opens above the list: bring it into view (the edit button may be far down the page).
  useEffect(() => {
    if (showCreate) formPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [showCreate, editing]);

  const handleClaim = useCallback(
    async (playbook: SerializedPlaybook) => {
      const actionKey = `claim:${playbook.id}`;
      setBusyAction(actionKey);
      try {
        await csrfFetch(`/api/playbooks/${playbook.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: playbook.id, claimOwnership: true }),
        });
        addToast("success", t("playbooksPage.toast.claimed"));
        void refresh();
      } catch (err) {
        addToast("error", getErrorMessage(err, t("playbooksPage.error.claim")));
      } finally {
        setBusyAction((prev) => (prev === actionKey ? null : prev));
      }
    },
    [addToast, refresh, t],
  );

  const handleToggle = useCallback(
    async (playbook: SerializedPlaybook) => {
      const actionKey = `toggle:${playbook.id}`;
      setBusyAction(actionKey);
      try {
        await csrfFetch(`/api/playbooks/${playbook.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: playbook.id, enabled: !playbook.enabled }),
        });
        addToast("success", t(playbook.enabled ? "playbooksPage.toast.disabled" : "playbooksPage.toast.enabled", { name: playbook.name }));
        void refresh();
      } catch (err) {
        addToast("error", getErrorMessage(err, t(playbook.enabled ? "playbooksPage.error.disable" : "playbooksPage.error.enable", { name: playbook.name })));
      } finally {
        setBusyAction((prev) => (prev === actionKey ? null : prev));
      }
    },
    [refresh, t, addToast],
  );

  const handleDelete = useCallback(
    async (playbook: SerializedPlaybook) => {
      setDeleteError(null);
      const actionKey = `delete:${playbook.id}`;
      setBusyAction(actionKey);
      try {
        await csrfFetch(`/api/playbooks/${playbook.id}`, { method: "DELETE" });
        setPendingDelete(null);
        addToast("success", t("playbooksPage.toast.deleted"));
        void refresh();
      } catch (err) {
        setDeleteError(getErrorMessage(err, t("playbooksPage.error.delete")));
      } finally {
        setBusyAction((prev) => (prev === actionKey ? null : prev));
      }
    },
    [refresh, t, addToast],
  );

  return (
    <div className="space-y-6">
      {header ? (
        <PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="">
          {canManage && !showCreate ? (
            <ActionButton icon={<Plus size={16} aria-hidden />} onClick={() => setShowCreate(true)}>
              {t("playbooksPage.action.create")}
            </ActionButton>
          ) : null}
        </PageHeader>
      ) : null}

      {showCreate && (
        <div ref={formPanelRef} className="scroll-mt-24">
          <SurfacePanel title={editing ? t("playbooksPage.editForm.title", { name: editing.name }) : t("playbooksPage.action.create")}>
            {/* Keyed by what is edited: opening another playbook starts from its own values. */}
            <PlaybookForm
              key={editing?.id ?? "new"}
              playbook={editing ?? undefined}
              servers={servers}
              canRun={canRun}
              onClose={() => { setShowCreate(false); setEditing(null); void refresh(); }}
            />
          </SurfacePanel>
        </div>
      )}

      <ListPanel
        title={t("playbooksPage.title")}
        count={playbooks.length}
        empty={
          playbooks.length === 0 ? (
            <EmptyState
              icon={<FileIcon size={24} />}
              title={t("playbooksPage.empty")}
              text={t("playbooksPage.emptyHint")}
              action={canManage && !showCreate ? (
                <ActionButton size="sm" variant="primary" onClick={() => setShowCreate(true)}>
                  {t("playbooksPage.action.create")}
                </ActionButton>
              ) : undefined}
            />
          ) : undefined
        }
        bodyClassName={playbooks.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
      >
        <PaginatedList pageSize={20}>
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
                onClaim={handleClaim}
                onEdit={handleEdit}
                editDisabled={showCreate}
                onDelete={(target) => { setDeleteError(null); setPendingDelete(target); }}
              />
            </div>
          ))}
        </PaginatedList>
      </ListPanel>

      <PlaybookDeleteDialog
        playbook={pendingDelete}
        busy={pendingDelete ? busyAction === `delete:${pendingDelete.id}` : false}
        error={deleteError}
        onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
      />
    </div>
  );
}
