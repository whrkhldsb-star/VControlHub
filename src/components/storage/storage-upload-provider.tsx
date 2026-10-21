"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Pause,
  Play,
  RefreshCw as RotateCcw,
  Upload,
  X,
  Trash2,
} from "@/components/icons";
import { StorageUploadQueue, type QueuedUpload } from "./storage-upload-queue";
import { useI18n } from "@/lib/i18n/use-locale";
import { IconButton } from "@/components/ui-primitives";
import { cn } from "@/lib/ui/cn";

const Context = createContext<StorageUploadQueue | null>(null);
const EMPTY: ReturnType<StorageUploadQueue["getSnapshot"]> = [];
const serverSnapshot = () => EMPTY;

const ACTIVE_STATES = new Set<QueuedUpload["state"]>(["pending", "uploading", "finalizing", "paused"]);
const FAILED_STATES = new Set<QueuedUpload["state"]>(["error", "cancel-error", "unknown"]);

export function useStorageUploads() {
  const shared = useContext(Context);
  const [local] = useState(() => new StorageUploadQueue());
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(disposal.current);
    return () => {
      disposal.current = setTimeout(() => local.dispose(), 0);
    };
  }, [local]);
  return shared ?? local;
}

/**
 * Upload progress, as a floating panel like a desktop drive's: it follows the
 * user across pages, folds to its header, and clears itself on request once
 * nothing is running. It sits bottom-left beside the sidebar so it never
 * covers the toasts in the bottom-right corner.
 */
export function StorageUploadStatus() {
  const queue = useStorageUploads();
  const { t } = useI18n();
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, serverSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;
  const active = items.filter((item) => ACTIVE_STATES.has(item.state));
  const failed = items.filter((item) => FAILED_STATES.has(item.state)).length;
  const done = items.filter((item) => item.state === "success").length;
  const counted = items.filter((item) => item.state !== "cancelled");
  const percent = counted.length
    ? Math.round(counted.reduce((sum, item) => sum + (item.state === "success" ? 100 : item.percent), 0) / counted.length)
    : 100;
  const title = active.length
    ? t("storageUpload.activeCount", { count: active.length })
    : failed
      ? t("storageUpload.failedCount", { count: failed })
      : t("storageUpload.doneCount", { count: done });
  return (
    <section
      role="region"
      aria-label={t("storageUpload.title")}
      data-popover=""
      data-upload-panel=""
      className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] w-auto !p-0 sm:right-auto sm:w-[23rem] lg:bottom-5 lg:left-[calc(var(--sidebar-current)+1.25rem)]"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span aria-hidden="true" className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", failed && !active.length ? "bg-[var(--danger-bg)] text-[var(--danger)]" : "bg-[var(--accent-bg)] text-[var(--accent)]")}>
          <Upload size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]" role="progressbar" aria-label={t("storageUpload.title")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className={cn("h-full rounded-full transition-[width]", failed && !active.length ? "bg-[var(--danger)]" : "bg-[var(--color-action)]")} style={{ width: `${percent}%` }} />
          </div>
        </div>
        <IconButton label={t(collapsed ? "storageUpload.expand" : "storageUpload.collapse")} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} className="h-8 w-8 shrink-0">
          <ChevronRight size={16} className={cn("transition-transform", collapsed ? "-rotate-90" : "rotate-90")} aria-hidden />
        </IconButton>
        {active.length ? null : (
          <IconButton label={t("storageUpload.clear")} onClick={() => queue.clearFinished()} className="h-8 w-8 shrink-0">
            <X size={16} aria-hidden />
          </IconButton>
        )}
      </div>
      {collapsed ? null : (
        <div className="border-t border-[var(--border-subtle)] px-3">
          <UploadQueueItems queue={queue} />
          {active.length && items.length > active.length ? (
            <div className="flex justify-end border-t border-[var(--border-subtle)] py-1.5">
              <button type="button" onClick={() => queue.clearFinished()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]">
                <Trash2 size={13} aria-hidden />
                {t("storageUpload.clear")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function UploadQueueItems({
  queue,
  ids,
}: {
  queue: StorageUploadQueue;
  ids?: string[];
}) {
  const items = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    serverSnapshot,
  );
  const { t } = useI18n();
  const visible = ids ? items.filter((item) => ids.includes(item.id)) : items;
  return (
    <ul className="max-h-72 divide-y divide-[var(--border-subtle)] overflow-y-auto text-sm">
      {visible.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[var(--text-primary)]" title={item.path}>{item.name}</p>
            <p className={cn("break-words text-xs", FAILED_STATES.has(item.state) ? "text-[var(--danger)]" : "text-[var(--text-secondary)]")}>
              {t(`fileUploadDropzone.status.${item.state}`)}
              {item.state === "uploading" ? ` ${item.percent}%` : ""}
            </p>
            {item.error ? (
              <p className="break-words text-xs text-[var(--danger)]">
                {item.error.startsWith("storageUpload.") ? t(item.error) : item.error}
              </p>
            ) : null}
            {ACTIVE_STATES.has(item.state) ? (
              <progress
                aria-label={item.name}
                value={item.percent}
                max={100}
                className="mt-1 h-1 w-full accent-[var(--color-action)]"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 gap-0.5">
            {["pending", "uploading"].includes(item.state) ? (
              <IconButton label={t("storageUpload.pause")} title={t("storageUpload.pause")} className="h-8 w-8" onClick={() => queue.pause(item.id)}>
                <Pause size={15} aria-hidden />
              </IconButton>
            ) : null}
            {["paused", "error", "cancel-error"].includes(item.state) ? (
              <IconButton
                label={t(item.state === "paused" ? "storageUpload.resume" : "storageUpload.retry")}
                title={t(item.state === "paused" ? "storageUpload.resume" : "storageUpload.retry")}
                disabled={queue.isSettling(item.id)}
                className="h-8 w-8 disabled:opacity-40"
                onClick={() => queue.resume(item.id)}
              >
                {item.state === "paused" ? <Play size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}
              </IconButton>
            ) : null}
            {["pending", "uploading", "paused", "error"].includes(item.state) ? (
              <IconButton label={t("storageUpload.cancel")} title={t("storageUpload.cancel")} className="h-8 w-8" onClick={() => queue.cancel(item.id)}>
                <X size={15} aria-hidden />
              </IconButton>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StorageUploadProvider({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string;
}) {
  const [queue] = useState(() => new StorageUploadQueue(scope));
  const disposal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(disposal.current);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        queue
          .getSnapshot()
          .some(
            (item) => !["success", "cancelled", "unknown"].includes(item.state),
          )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const completed = new Set<string>();
    const unsubscribe = queue.subscribe(() => {
      for (const item of queue.getSnapshot())
        if (item.state === "success" && !completed.has(item.id)) {
          completed.add(item.id);
          window.dispatchEvent(
            new CustomEvent("storage-upload-completed", {
              detail: { nodeId: item.nodeId },
            }),
          );
        }
    });
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", beforeUnload);
      disposal.current = setTimeout(() => queue.dispose(), 0);
    };
  }, [queue]);
  return <Context.Provider value={queue}>{children}</Context.Provider>;
}
