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
  Pause,
  Play,
  RefreshCw as RotateCcw,
  Upload,
  X,
  Trash2,
} from "@/components/icons";
import { StorageUploadQueue } from "./storage-upload-queue";
import { useI18n } from "@/lib/i18n/use-locale";
import { ModalShell } from "@/components/modal-shell";

const Context = createContext<StorageUploadQueue | null>(null);
const OpenQueueContext = createContext<(() => void) | null>(null);
const EMPTY: ReturnType<StorageUploadQueue["getSnapshot"]> = [];
const serverSnapshot = () => EMPTY;

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

export function StorageUploadStatus() {
  const queue = useStorageUploads();
  const open = useContext(OpenQueueContext);
  const { t } = useI18n();
  const items = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    serverSnapshot,
  );
  if (!items.length) return null;
  return (
    <div className="sticky top-0 z-40 flex h-12 justify-end border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <button
        type="button"
        onClick={() => open?.()}
        title={t("storageUpload.title")}
        className="flex items-center gap-2 text-sm text-[var(--text-primary)]"
      >
        <Upload size={16} />
        <span>
          {t("storageUpload.title")}{" "}
          {items.filter((item) => item.state === "success").length}/
          {items.length}
        </span>
      </button>
    </div>
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
    <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto text-sm">
      {visible.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="break-all text-[var(--text-primary)]">{item.name}</p>
            <p className="break-words text-xs text-[var(--text-secondary)]">
              {t(`fileUploadDropzone.status.${item.state}`)}
              {item.state === "uploading" ? ` ${item.percent}%` : ""}
            </p>
            {item.error ? (
              <p className="break-words text-xs text-[var(--danger)]">
                {item.error.startsWith("storageUpload.")
                  ? t(item.error)
                  : item.error}
              </p>
            ) : null}
            <progress
              aria-label={item.name}
              value={item.percent}
              max={100}
              className="mt-1 h-1 w-full accent-[var(--color-action)]"
            />
          </div>
          <div className="flex shrink-0 gap-1">
            {["pending", "uploading"].includes(item.state) ? (
              <button
                type="button"
                title={t("storageUpload.pause")}
                aria-label={t("storageUpload.pause")}
                className="rounded p-2 hover:bg-[var(--surface-hover)]"
                onClick={() => queue.pause(item.id)}
              >
                <Pause size={16} />
              </button>
            ) : null}
            {["paused", "error", "cancel-error"].includes(item.state) ? (
              <button
                type="button"
                title={t(
                  item.state === "paused"
                    ? "storageUpload.resume"
                    : "storageUpload.retry",
                )}
                aria-label={t(
                  item.state === "paused"
                    ? "storageUpload.resume"
                    : "storageUpload.retry",
                )}
                disabled={queue.isSettling(item.id)}
                className="rounded p-2 hover:bg-[var(--surface-hover)] disabled:opacity-40"
                onClick={() => queue.resume(item.id)}
              >
                {item.state === "paused" ? (
                  <Play size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
              </button>
            ) : null}
            {["pending", "uploading", "paused", "error"].includes(
              item.state,
            ) ? (
              <button
                type="button"
                title={t("storageUpload.cancel")}
                aria-label={t("storageUpload.cancel")}
                className="rounded p-2 hover:bg-[var(--surface-hover)]"
                onClick={() => queue.cancel(item.id)}
              >
                <X size={16} />
              </button>
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
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
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
  return (
    <Context.Provider value={queue}>
      <OpenQueueContext.Provider value={() => setOpen(true)}>
        {children}
      </OpenQueueContext.Provider>
      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        label={t("storageUpload.title")}
        panelClassName="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t("storageUpload.title")}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              title={t("storageUpload.clear")}
              aria-label={t("storageUpload.clear")}
              onClick={() => queue.clearFinished()}
              className="p-2"
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              aria-label={t("storageUpload.close")}
              onClick={() => setOpen(false)}
              className="p-2"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <UploadQueueItems queue={queue} />
      </ModalShell>
    </Context.Provider>
  );
}
