"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { EmptyState, ListPanel, PageHeader, SurfacePanel, Toolbar } from "@/components/page-shell";
import { File as FileIcon, Plus } from "@/components/icons";
import { statusLabelFor, dryRunStepCounts } from "./playbook-types";
import type { SerializedPlaybook, RunSummary, ServerOption } from "./playbook-types";
import { PlaybookForm } from "./playbook-form";
import { PlaybookCard } from "./playbook-card";
import { PlaybookDeleteDialog } from "./playbook-delete-dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageGuide } from "@/components/page-guide";
import { PaginatedList } from "@/components/paginated-list";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

const RUN_POLL_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000, 240_000, 300_000] as const;

type Props = {
  /** Page header; rendered here so the create command sits in its actions. */
  header?: { eyebrow?: string; title: string; description?: string };
  playbooks: SerializedPlaybook[];
  runsByPlaybook: Record<string, RunSummary[]>;
  servers: ServerOption[];
  canManage: boolean;
  canRun: boolean;
  canReadCommands?: boolean;
  canManageAlerts?: boolean;
};

export function PlaybookListClient({
  header,
  playbooks: initial,
  runsByPlaybook: initialRuns,
  servers,
  canManage,
  canRun,
  canReadCommands = false,
  canManageAlerts = false,
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
  const [pendingRun, setPendingRun] = useState<SerializedPlaybook | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // A refused deletion is said in its dialog; every other action answers with a toast, where the click was.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const filteredPlaybooks = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return playbooks;
    return playbooks.filter(
      (pb) =>
        pb.name.toLowerCase().includes(needle) ||
        (pb.description ?? "").toLowerCase().includes(needle),
    );
  }, [playbooks, searchQuery]);

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
  const runPollGenRef = useRef<Map<string, number>>(new Map());
  const mountedRef = useRef(true);

  const clearRunPolling = useCallback((pollKey?: string) => {
    const map = runPollTimersRef.current;
    const gens = runPollGenRef.current;
    if (pollKey) {
      const timer = map.get(pollKey);
      if (timer !== undefined) window.clearTimeout(timer);
      map.delete(pollKey);
      gens.set(pollKey, (gens.get(pollKey) ?? 0) + 1);
      return;
    }
    for (const timer of map.values()) window.clearTimeout(timer);
    map.clear();
    gens.clear();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRunPolling();
    };
  }, [clearRunPolling]);

  const isTerminalRunStatus = useCallback((status: string) => {
    return status === "completed" || status === "failed" || status === "cancelled";
  }, []);

  const startRunPolling = useCallback(
    (playbookId: string, runId: string, kind: "run" | "dry-run") => {
      const pollKey = `${playbookId}:${runId}`;
      clearRunPolling(pollKey);
      const gen = (runPollGenRef.current.get(pollKey) ?? 0) + 1;
      runPollGenRef.current.set(pollKey, gen);
      let attempt = 0;

      const isActive = () => mountedRef.current && runPollGenRef.current.get(pollKey) === gen;

      const scheduleNext = () => {
        if (!isActive()) return;
        if (attempt >= RUN_POLL_DELAYS_MS.length) {
          clearRunPolling(pollKey);
          addToast("info", t("playbooksPage.toast.pollTimeout"));
          return;
        }
        const delay = RUN_POLL_DELAYS_MS[attempt];
        attempt += 1;
        const timer = window.setTimeout(() => {
          void refreshRuns(playbookId)
            .then((runs) => {
              if (!isActive()) return;
              const target = runs.find((candidate) => candidate.id === runId);
              if (target && isTerminalRunStatus(target.status)) {
                clearRunPolling(pollKey);
                if (kind === "dry-run") {
                  if (target.status === "failed" || target.status === "cancelled") {
                    addToast("error", t("playbooksPage.toast.run", { status: statusLabelFor(t, target.status) }));
                  } else {
                    const counts = dryRunStepCounts(target);
                    addToast("success", t("playbooksPage.toast.dryRun", { ok: counts.ok, total: counts.total }));
                  }
                } else {
                  addToast(
                    target.status === "failed" ? "error" : "success",
                    t("playbooksPage.toast.run", { status: statusLabelFor(t, target.status) }),
                  );
                }
                return;
              }
              scheduleNext();
            })
            .catch(() => {
              if (!isActive()) return;
              scheduleNext();
            });
        }, delay);
        runPollTimersRef.current.set(pollKey, timer);
      };

      scheduleNext();
    },
    [addToast, clearRunPolling, isTerminalRunStatus, refreshRuns, t],
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
          // Durable worker finishes asynchronously; poll this specific run until terminal or max window.
          startRunPolling(id, run.id, kind);
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
          {canReadCommands ? (
            <ButtonLink href="/scheduled-tasks" size="sm" variant="secondary">
              {t("playbooksPage.openScheduledTasks")}
            </ButtonLink>
          ) : null}
          {canManage && !showCreate ? (
            <ActionButton icon={<Plus size={16} aria-hidden />} onClick={() => setShowCreate(true)}>
              {t("playbooksPage.action.create")}
            </ActionButton>
          ) : null}
        </PageHeader>
      ) : null}
      <PageGuide
        title={t("playbooksPage.guide.title")}
        summary={t("playbooksPage.guide.summary")}
        steps={[
          t("playbooksPage.guide.step1"),
          t("playbooksPage.guide.step2"),
          t("playbooksPage.guide.step3"),
        ]}
        links={[
          ...(canReadCommands ? [{ label: t("playbooksPage.openScheduledTasks"), href: "/scheduled-tasks" }] : []),
          ...(canManageAlerts ? [{ label: t("playbooksPage.openAlertRules"), href: "/alert-rules" }] : []),
        ]}
      />

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

      {playbooks.length > 0 ? (
        <Toolbar>
          <label htmlFor="playbooks-search" className="sr-only">{t("common.search")}</label>
          <input
            id="playbooks-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("playbooksPage.searchPlaceholder")}
            className={cn(UI_INPUT, "w-full sm:w-80")}
          />
          {searchQuery ? (
            <ActionButton size="sm" variant="ghost" onClick={() => setSearchQuery("")}>
              {t("common.clearSearch")}
            </ActionButton>
          ) : null}
        </Toolbar>
      ) : null}

      <ListPanel
        title={t("playbooksPage.list.title")}
        count={filteredPlaybooks.length}
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
          ) : filteredPlaybooks.length === 0 ? (
            <EmptyState
              title={t("common.noMatches")}
              action={
                <ActionButton size="sm" variant="secondary" onClick={() => setSearchQuery("")}>
                  {t("common.clearSearch")}
                </ActionButton>
              }
            />
          ) : undefined
        }
        bodyClassName={filteredPlaybooks.length === 0 ? undefined : "!divide-y-0 space-y-0 bg-transparent p-3"}
      >
        <PaginatedList pageSize={20} resetKey={searchQuery}>
          {filteredPlaybooks.map((playbook) => (
            <div key={playbook.id} className="mb-3 last:mb-0">
              <PlaybookCard
                playbook={playbook}
                runs={runsByPlaybook[playbook.id]}
                canRun={canRun}
                canManage={canManage}
                busyAction={busyAction}
                onTrigger={(id, kind) => {
                  if (kind === "run") {
                    const target = playbooks.find((item) => item.id === id) ?? null;
                    setPendingRun(target);
                    return;
                  }
                  void handleTrigger(id, kind);
                }}
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

      <ConfirmDialog
        open={pendingRun !== null}
        title={t("playbooksPage.runConfirm.title", { name: pendingRun?.name ?? "" })}
        description={pendingRun ? t("playbooksPage.runConfirm.desc", { name: pendingRun.name, count: pendingRun.steps.length }) : undefined}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("playbooksPage.action.run")}
        confirmVariant="primary"
        busy={pendingRun ? busyAction === `run:${pendingRun.id}` : false}
        onCancel={() => setPendingRun(null)}
        onConfirm={() => {
          if (!pendingRun) return;
          const targetId = pendingRun.id;
          setPendingRun(null);
          void handleTrigger(targetId, "run");
        }}
      />

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
