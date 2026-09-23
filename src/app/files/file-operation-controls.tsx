"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, X, RefreshCw } from "@/components/icons";
import { ModalShell } from "@/components/modal-shell";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { FolderDestinationPicker } from "./folder-destination-picker";
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
  window.dispatchEvent(new Event("file-operations-changed"));
  return result;
}

export function CopyFileButton({
  ids,
  nodeId,
  onSubmitted,
}: {
  ids: string[];
  nodeId?: string;
  onSubmitted?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [targetDir, setTargetDir] = useState(".");
  const [policy, setPolicy] = useState<"rename" | "skip" | "overwrite">(
    "rename",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const pending = useRef(false);
  return (
    <>
      <ActionButton variant="outline" onClick={() => setOpen(true)}>
        <Copy size={16} />
        {t("fileOperations.copy")}
      </ActionButton>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        label={t("fileOperations.copy")}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("fileOperations.copy")}</h2>
          <button
            type="button"
            className="p-2"
            aria-label={t("common.close")}
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="mt-4 grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            const key = JSON.stringify({ ids, targetDir, policy });
            if (attempt.current?.key !== key)
              attempt.current = { key, id: crypto.randomUUID() };
            try {
              await submitFileOperation(
                { action: "copy", fileEntryIds: ids, targetDir, policy },
                attempt.current.id,
              );
              setOpen(false);
              onSubmitted?.();
              attempt.current = null;
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : t("filePreferences.failed"),
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <label className="grid gap-2 text-sm">
            <span>{t("filesPage.actions.targetPath")}</span>
            <input
              className={UI_INPUT}
              value={targetDir}
              disabled={busy}
              required
              onChange={(event) => setTargetDir(event.currentTarget.value)}
            />
          </label>
          {nodeId ? (
            <FolderDestinationPicker
              nodeId={nodeId}
              disabled={busy}
              onSelect={setTargetDir}
            />
          ) : null}
          <label className="grid gap-2 text-sm">
            <span>{t("fileOperations.conflict")}</span>
            <select
              className={UI_INPUT}
              value={policy}
              disabled={busy}
              onChange={(event) =>
                setPolicy(event.currentTarget.value as typeof policy)
              }
            >
              {(["rename", "skip", "overwrite"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`fileOperations.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {policy === "overwrite" ? (
            <Notice tone="warning">
              {t("fileOperations.overwriteNotice")}
            </Notice>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <ActionButton type="submit" disabled={busy}>
            {t(busy ? "common.executing" : "common.confirm")}
          </ActionButton>
        </form>
      </ModalShell>
    </>
  );
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
export function FileOperationTasks() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const completed = useRef(new Set<string>());
  const retries = useRef(new Map<string, string>());
  const hasActive = jobs.some((job) =>
    ["PENDING", "RUNNING"].includes(job.status),
  );
  useEffect(() => {
    const changed = () => {
      setOpen(true);
      setReload((value) => value + 1);
    };
    window.addEventListener("file-operations-changed", changed);
    return () => window.removeEventListener("file-operations-changed", changed);
  }, []);
  useEffect(() => {
    if (!open && !hasActive) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await csrfFetch<{ jobs: Job[] }>(
          "/api/files/operations",
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          for (const job of result.jobs)
            if (
              !["PENDING", "RUNNING"].includes(job.status) &&
              !completed.current.has(job.id)
            ) {
              completed.current.add(job.id);
              window.dispatchEvent(new Event("file-operation-completed"));
            }
          setJobs(result.jobs);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : t("filePreferences.failed"),
          );
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 2500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, hasActive, reload, t]);
  return (
    <>
      <ActionButton variant="outline" onClick={() => setOpen(true)}>
        {t("fileOperations.tasks")}
      </ActionButton>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        label={t("fileOperations.tasks")}
        panelClassName="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] p-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("fileOperations.tasks")}</h2>
          <button
            type="button"
            className="p-2"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        {error ? (
          <Notice tone="danger">
            {error}
            <button
              type="button"
              aria-label={t("storageUpload.retry")}
              className="p-2"
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw size={16} />
            </button>
          </Notice>
        ) : null}
        {!jobs.length ? (
          <p className="py-6 text-sm text-[var(--text-muted)]">
            {t("fileOperations.empty")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {jobs.map((job) => (
              <li key={job.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p>
                    {job.action
                      ? `${t(`fileOperations.${job.action}`)}${job.count !== null ? ` ${job.count}` : ""}`
                      : job.title}{" "}
                    · {t(`fileOperations.status.${job.status}`)} {job.progress}
                  </p>
                  {["RUNNING", "PENDING"].includes(job.status) ? (
                    <button
                      type="button"
                      aria-label={t("common.cancel")}
                      title={t("fileOperations.cancelNotice")}
                      disabled={busy === job.id || job.cancelRequested}
                      className="p-2"
                      onClick={async () => {
                        setBusy(job.id);
                        try {
                          await csrfFetch("/api/files/operations", {
                            method: "PATCH",
                            body: JSON.stringify({ id: job.id }),
                          });
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : t("filePreferences.failed"),
                          );
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <X size={16} />
                    </button>
                  ) : null}
                </div>
                {job.retry ? (
                  <ActionButton
                    variant="outline"
                    disabled={busy === job.id}
                    onClick={async () => {
                      setBusy(job.id);
                      const requestId =
                        retries.current.get(job.id) ?? crypto.randomUUID();
                      retries.current.set(job.id, requestId);
                      try {
                        await submitFileOperation(job.retry!, requestId);
                        setReload((value) => value + 1);
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : t("filePreferences.failed"),
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <RefreshCw size={14} />
                    {t("fileOperations.retryFailed")}
                  </ActionButton>
                ) : null}
                {job.cancelRequested &&
                ["RUNNING", "PENDING"].includes(job.status) ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("fileOperations.cancelNotice")}
                  </p>
                ) : null}
                {job.errorMessage ? (
                  <p className="break-words text-xs text-[var(--danger)]">
                    {job.errorMessage}
                  </p>
                ) : null}
                {job.result?.items?.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs">
                      {t("fileOperations.results")}
                    </summary>
                    <ul className="mt-2 max-h-52 overflow-y-auto">
                      {job.result.items.map((item) => (
                        <li key={item.id} className="break-all py-1 text-xs">
                          {item.path ?? item.name ?? item.id} ·{" "}
                          {t(`fileOperations.item.${item.state}`)}
                          {item.error ? `: ${item.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ModalShell>
    </>
  );
}
