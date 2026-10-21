"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, RefreshCw } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/page-shell";
import { ActionButton } from "@/components/action-button";
import { IconButton, Notice } from "@/components/ui-primitives";
import { useToast } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type {
  FileOperationInput,
  FileOperationResult,
} from "@/lib/files/operation-schema";

export async function submitFileOperation(
  input: Omit<FileOperationInput, "requestId">,
  requestId = crypto.randomUUID(),
) {
  const result = await csrfFetch<{ id: string }>("/api/files/operations", {
    method: "POST",
    body: JSON.stringify({ ...input, requestId }),
  });
  window.dispatchEvent(new CustomEvent("file-operations-changed", { detail: { id: result.id } }));
  return result;
}

type Job = {
  id: string;
  title: string;
  /** Structured action from the server (payload-derived); null on unparsable rows. */
  action: "copy" | "move" | "delete" | null;
  /** Number of entries the job covers; null on unparsable rows. */
  count: number | null;
  status: string;
  progress: string | null;
  errorMessage: string | null;
  result?: { items?: FileOperationResult[] } | null;
  cancelRequested?: boolean;
  retry?: FileOperationInput | null;
};

const ACTIVE = ["PENDING", "RUNNING"];

/**
 * Background copy / move / delete jobs. Polls while a job runs (or the list
 * is open), refreshes the listing when one finishes and says how it went in a
 * toast — the list opens only when asked, through `trigger`.
 */
export function FileOperationTasks({ trigger }: {
  /** Renders the control that opens the task list; `active` counts running jobs. */
  trigger: (state: { active: number; open: () => void }) => ReactNode;
}) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [watching, setWatching] = useState(false);
  const known = useRef(new Set<string>());
  const seenActive = useRef(new Set<string>());
  const retries = useRef(new Map<string, string>());
  const active = jobs.filter((job) => ACTIVE.includes(job.status)).length;
  const latest = useRef({ addToast, t });
  useEffect(() => {
    latest.current = { addToast, t };
  }, [addToast, t]);

  useEffect(() => {
    const changed = (event: Event) => {
      // A job submitted here is watched even if it finishes before the next poll.
      const id = (event as CustomEvent<{ id?: string } | undefined>).detail?.id;
      if (id) seenActive.current.add(id);
      setWatching(true);
      setReload((value) => value + 1);
    };
    window.addEventListener("file-operations-changed", changed);
    return () => window.removeEventListener("file-operations-changed", changed);
  }, []);

  useEffect(() => {
    // Poll while the list is open or a job submitted here is still running.
    if (!open && !watching) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await csrfFetch<{ jobs: Job[] }>("/api/files/operations", { signal: controller.signal });
        if (controller.signal.aborted) return;
        for (const job of result.jobs) {
          if (ACTIVE.includes(job.status)) {
            seenActive.current.add(job.id);
            continue;
          }
          if (known.current.has(job.id)) continue;
          known.current.add(job.id);
          window.dispatchEvent(new Event("file-operation-completed"));
          // Only jobs submitted or seen running here get a toast, not older history.
          if (!seenActive.current.has(job.id)) continue;
          const { addToast: toast, t: tr } = latest.current;
          const action = job.action ? tr(`fileOperations.${job.action}`) : job.title;
          const failed = job.status !== "COMPLETED" && job.status !== "SUCCEEDED"
            || (job.result?.items ?? []).some((item) => item.state === "error");
          toast(failed ? "warning" : "success", tr(failed ? "filesPage.drive.taskIncomplete" : "filesPage.drive.taskDone", {
            action,
            count: job.count ?? 0,
          }));
        }
        setJobs(result.jobs);
        setError("");
        if (!result.jobs.some((job) => ACTIVE.includes(job.status))) setWatching(false);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : latest.current.t("filePreferences.failed"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 2500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, watching, reload]);

  return (
    <>
      {trigger({ active, open: () => setOpen(true) })}
      <Dialog size="xl" open={open} onClose={() => setOpen(false)} title={t("fileOperations.tasks")}>
        {error ? (
          <Notice tone="danger" action={{ label: t("storageUpload.retry"), onClick: () => setReload((value) => value + 1) }}>
            {error}
          </Notice>
        ) : null}
        {!jobs.length ? (
          <EmptyState text={t("fileOperations.empty")} />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {jobs.map((job) => (
              <li key={job.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 break-words">
                    {job.action
                      ? `${t(`fileOperations.${job.action}`)}${job.count !== null ? ` ${job.count}` : ""}`
                      : job.title}{" "}
                    · {t(`fileOperations.status.${job.status}`)} {job.progress}
                  </p>
                  {ACTIVE.includes(job.status) ? (
                    <IconButton
                      label={t("common.cancel")}
                      title={t("fileOperations.cancelNotice")}
                      disabled={busy === job.id || job.cancelRequested}
                      onClick={async () => {
                        setBusy(job.id);
                        try {
                          await csrfFetch("/api/files/operations", { method: "PATCH", body: JSON.stringify({ id: job.id }) });
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : t("filePreferences.failed"));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <X size={16} aria-hidden />
                    </IconButton>
                  ) : null}
                </div>
                {job.retry ? (
                  <ActionButton
                    size="sm"
                    variant="outline"
                    icon={<RefreshCw aria-hidden />}
                    className="mt-2"
                    disabled={busy === job.id}
                    onClick={async () => {
                      setBusy(job.id);
                      const requestId = retries.current.get(job.id) ?? crypto.randomUUID();
                      retries.current.set(job.id, requestId);
                      try {
                        await submitFileOperation(job.retry!, requestId);
                        setReload((value) => value + 1);
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : t("filePreferences.failed"));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {t("fileOperations.retryFailed")}
                  </ActionButton>
                ) : null}
                {job.cancelRequested && ACTIVE.includes(job.status) ? (
                  <p className="text-xs text-[var(--text-muted)]">{t("fileOperations.cancelNotice")}</p>
                ) : null}
                {job.errorMessage ? <p className="break-words text-xs text-[var(--danger)]">{job.errorMessage}</p> : null}
                {job.result?.items?.length ? (
                  <Disclosure variant="inset" title={t("fileOperations.results")} className="mt-2">
                    <ul className="max-h-52 overflow-y-auto">
                      {job.result.items.map((item) => (
                        <li key={item.id} className="break-all py-1 text-xs">
                          {item.path ?? item.name ?? item.id} · {t(`fileOperations.item.${item.state}`)}
                          {item.error ? `: ${item.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
