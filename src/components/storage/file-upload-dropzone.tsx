"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder as FolderUp, Upload } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  DEFAULT_NODE,
  formatUploadMessage,
  getBrowserRelativePath,
  normalizeRelativePath,
  type StorageUploadNode,
  type UploadMessage,
} from "./file-upload-helpers";
import { UI_INPUT } from "@/lib/ui/classes";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { UploadQueueItems, useStorageUploads } from "./storage-upload-provider";
import { readDroppedFiles } from "./storage-drop-files";

export function FileUploadDropzone({
  nodes,
  initialNodeId,
  uploadDir,
  initialRelativeDir = "",
  title,
  description,
  submitLabel,
  pathLabel,
  allowNodeSelection = true,
  embedded = false,
  onUploadComplete,
}: {
  nodes: StorageUploadNode[];
  initialNodeId?: string;
  uploadDir?: string;
  initialRelativeDir?: string;
  title: string;
  description: string;
  submitLabel: string;
  pathLabel: string;
  allowNodeSelection?: boolean;
  embedded?: boolean;
  onUploadComplete?: (payload: {
    relativePath?: string;
    size?: number;
  }) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const queue = useStorageUploads();
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(
    initialNodeId ??
      nodes.find((node) => node.driver === "LOCAL")?.id ??
      DEFAULT_NODE,
  );
  const [previousNode, setPreviousNode] = useState(initialNodeId);
  if (previousNode !== initialNodeId) {
    setPreviousNode(initialNodeId);
    setSelectedNodeId(
      initialNodeId ??
        nodes.find((node) => node.driver === "LOCAL")?.id ??
        DEFAULT_NODE,
    );
  }
  const [relativeDir, setRelativeDir] = useState(initialRelativeDir);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<UploadMessage>(null);
  const [ids, setIds] = useState<string[]>([]);
  const completed = useRef(new Set<string>());
  const effectiveRelativeDir = uploadDir ?? relativeDir;
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const uploadEnabled =
    !!selectedNode && ["LOCAL", "SFTP", "WEBDAV"].includes(selectedNode.driver);
  const latest = useRef({ onUploadComplete, router });
  useEffect(() => {
    latest.current = { onUploadComplete, router };
  }, [onUploadComplete, router]);
  useEffect(() => {
    const notify = () => {
      const batch = queue.getSnapshot().filter((item) => ids.includes(item.id));
      for (const item of batch) {
        if (item.state !== "success" || completed.current.has(item.id))
          continue;
        completed.current.add(item.id);
        if (latest.current.onUploadComplete)
          latest.current.onUploadComplete({
            relativePath: item.path,
            size: item.size,
          });
        else latest.current.router.refresh();
      }
      if (
        !batch.length ||
        batch.some((item) =>
          ["pending", "uploading", "finalizing", "paused"].includes(item.state),
        )
      )
        return;
      const success = batch.filter((item) => item.state === "success").length;
      const failure = batch.length - success;
      const key =
        batch.length === 1 && success === 1
          ? "singleSuccess"
          : failure === 0
            ? "allSuccess"
            : success
              ? "partialSuccess"
              : "failed";
      setMessage({
        type: failure ? "error" : "success",
        text: formatUploadMessage(t(`fileUploadDropzone.summary.${key}`), {
          path: batch[0]!.path,
          size: batch[0]!.size,
          success,
          failure,
          total: batch.length,
        }),
      });
    };
    const unsubscribe = queue.subscribe(notify);
    notify();
    return unsubscribe;
  }, [queue, ids, t]);

  function uploadFiles(files: File[]) {
    try {
      if (!uploadEnabled)
        throw new Error(
          t(
            selectedNodeId
              ? "fileUploadDropzone.errorUnsupportedNode"
              : "fileUploadDropzone.errorNoNode",
          ),
        );
      const base = normalizeRelativePath(effectiveRelativeDir);
      if (!base.ok)
        throw new Error(t(`fileUploadDropzone.pathError.${base.reason}`));
      const valid: Array<{ file: File; path: string }> = [];
      const errors: string[] = [];
      for (const file of files) {
        const normalized = normalizeRelativePath(
          [base.path, getBrowserRelativePath(file)].filter(Boolean).join("/"),
        );
        if (!normalized.ok)
          errors.push(t(`fileUploadDropzone.pathError.${normalized.reason}`));
        else valid.push({ file, path: normalized.path });
      }
      if (valid.length) {
        const nextIds = queue.enqueue(valid, selectedNodeId);
        setIds((prev) => [...prev, ...nextIds]);
      }
      setMessage(
        errors.length ? { type: "error", text: errors.join("; ") } : null,
      );
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : t("fileUploadDropzone.errorUpload");
      setMessage({
        type: "error",
        text: text.startsWith("storageUpload.") ? t(text) : text,
      });
    }
  }
  return (
    <section className={embedded ? "" : "border-t border-[var(--border)] py-6"}>
      {!embedded ? (
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        </div>
      ) : null}
      <div
        className={`mt-4 grid gap-4 ${allowNodeSelection ? "md:grid-cols-2" : ""}`}
      >
        {allowNodeSelection ? (
          <label className="grid min-w-0 gap-2 text-sm">
            <span>{t("fileUploadDropzone.uploadToNode")}</span>
            <select
              aria-label={t("fileUploadDropzone.uploadToNode")}
              value={selectedNodeId}
              onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
              className={UI_INPUT}
            >
              <option value="">
                {t("fileUploadDropzone.selectStorageNode")}
              </option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} · {getStorageDriverLabel(t, node.driver)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="grid min-w-0 gap-2 text-sm">
          <span>{pathLabel}</span>
          <input
            aria-label={pathLabel}
            value={effectiveRelativeDir}
            readOnly={uploadDir !== undefined || !allowNodeSelection}
            onChange={(event) => setRelativeDir(event.currentTarget.value)}
            className={UI_INPUT}
            placeholder={t("fileUploadDropzone.pathPlaceholder")}
          />
        </label>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          uploadFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={t("fileUploadDropzone.selectFolderAriaLabel")}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          uploadFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        aria-label={submitLabel}
        onClick={() => inputRef.current?.click()}
        disabled={!uploadEnabled}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          try {
            uploadFiles(await readDroppedFiles(event.dataTransfer));
          } catch (error) {
            setMessage({
              type: "error",
              text:
                error instanceof Error
                  ? t(error.message)
                  : t("fileUploadDropzone.errorUpload"),
            });
          }
        }}
        className={`mt-4 flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-5 text-center disabled:opacity-50 ${dragActive ? "border-[var(--color-action)] bg-[var(--color-action-bg)]" : "border-[var(--border)] bg-[var(--surface-subtle)]"}`}
      >
        <Upload size={24} />
        <span className="text-sm font-medium">{submitLabel}</span>
        {!uploadEnabled ? (
          <span className="text-xs">
            {t(
              selectedNodeId
                ? "fileUploadDropzone.errorUnsupportedNode"
                : "fileUploadDropzone.errorNoNode",
            )}
          </span>
        ) : null}
      </button>
      <ActionButton
        variant="outline"
        className="mt-3"
        onClick={() => directoryInputRef.current?.click()}
        disabled={!uploadEnabled}
      >
        <FolderUp size={16} />
        {t("fileUploadDropzone.selectFolder")}
      </ActionButton>
      {message ? (
        <Notice
          tone={message.type === "success" ? "success" : "danger"}
          className="mt-4"
        >
          {message.text}
        </Notice>
      ) : null}
      <UploadQueueItems queue={queue} ids={ids} />
    </section>
  );
}
