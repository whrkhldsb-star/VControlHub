"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  DEFAULT_NODE,
  formatUploadMessage,
  getBrowserRelativePath,
  getUploadDisplayPath,
  normalizeRelativePath,
  type PathValidationError,
  type StorageUploadNode,
  type UploadMessage,
  type UploadQueueItem,
} from "./file-upload-helpers";
import {
  STORAGE_CHUNKED_THRESHOLD_BYTES,
  uploadStorageFileChunked,
} from "./storage-chunked-upload";

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
  onUploadComplete?: (payload: {
    relativePath?: string;
    size?: number;
  }) => void;
}) {
  const router = useRouter();
  const { t: tr } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(
    initialNodeId ??
      nodes.find((node) => node.driver === "LOCAL")?.id ??
      DEFAULT_NODE,
  );
  const [relativeDir, setRelativeDir] = useState(initialRelativeDir);
  const effectiveRelativeDir = uploadDir ?? relativeDir;
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<UploadMessage>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const uploadEnabled = selectedNode
    ? ["LOCAL", "SFTP"].includes(selectedNode.driver)
    : false;
  const uploadUnavailableHint = uploadEnabled
    ? null
    : selectedNodeId
      ? tr("fileUploadDropzone.errorUnsupportedNode")
      : tr("fileUploadDropzone.errorNoNode");
  const pathErrorMessage = (reason: PathValidationError) =>
    tr(`fileUploadDropzone.pathError.${reason}`);
  const formatMessage = (
    key: string,
    values: Record<string, string | number>,
  ) => formatUploadMessage(tr(key), values);
  /* eslint-disable react-hooks/set-state-in-effect */ useEffect(() => {
    const nextNodeId =
      initialNodeId ??
      nodes.find((node) => node.driver === "LOCAL")?.id ??
      DEFAULT_NODE;
    setSelectedNodeId(nextNodeId);
  }, [initialNodeId, nodes]);
  /* eslint-enable react-hooks/set-state-in-effect */ async function uploadFiles(
    files: File[],
  ) {
    if (!selectedNodeId) {
      setMessage({ type: "error", text: tr("fileUploadDropzone.errorNoNode") });
      return;
    }
    if (!uploadEnabled) {
      setMessage({
        type: "error",
        text: tr("fileUploadDropzone.errorUnsupportedNode"),
      });
      return;
    }
    const uploadItems = files.filter((file) => file.size >= 0);
    if (uploadItems.length === 0) return;
    const baseDirResult = normalizeRelativePath(effectiveRelativeDir);
    if (!baseDirResult.ok) {
      setMessage({
        type: "error",
        text: pathErrorMessage(baseDirResult.reason),
      });
      setSubmitting(false);
      return;
    }
    const baseDir = baseDirResult.path;
    setSubmitting(true);
    setMessage(null);
    setQueue(
      uploadItems.map((file) => ({
        name: getUploadDisplayPath(file),
        status: "pending",
        message: tr("fileUploadDropzone.queue.pending"),
      })),
    );
    let successCount = 0;
    let failureCount = 0;
    for (let index = 0; index < uploadItems.length; index++) {
      const file = uploadItems[index]!;
      const itemPathResult = normalizeRelativePath(
        getBrowserRelativePath(file),
      );
      if (!itemPathResult.ok) {
        failureCount++;
        setQueue((prev) =>
          prev.map((item, i) =>
            i === index
              ? {
                  ...item,
                  status: "error",
                  message: formatMessage("fileUploadDropzone.queue.failed", {
                    message: pathErrorMessage(itemPathResult.reason),
                  }),
                }
              : item,
          ),
        );
        continue;
      }
      const relativePath = [baseDir, itemPathResult.path]
        .filter(Boolean)
        .join("/");
      setQueue((prev) =>
        prev.map((item, i) =>
          i === index
            ? {
                ...item,
                status: "uploading",
                message: tr("fileUploadDropzone.queue.uploading"),
              }
            : item,
        ),
      );
      try {
        let uploadedPath = relativePath;
        let uploadedSize = file!.size;
        if (file!.size >= STORAGE_CHUNKED_THRESHOLD_BYTES) {
          const chunked = await uploadStorageFileChunked({
            file: file!,
            storageNodeId: selectedNodeId,
            relativePath,
            onProgress: (progress) => {
              setQueue((prev) =>
                prev.map((item, i) =>
                  i === index
                    ? {
                        ...item,
                        status: "uploading",
                        message: `${tr("fileUploadDropzone.queue.uploading")} ${progress.percent}%`,
                      }
                    : item,
                ),
              );
            },
          });
          uploadedPath = chunked.relativePath;
          uploadedSize = chunked.size;
        } else {
          const formData = new FormData();
          formData.set("storageNodeId", selectedNodeId);
          formData.set("relativePath", relativePath);
          formData.set("file", file!);
          const data = (await csrfFetch("/api/storage/local", {
            method: "POST",
            body: formData,
          })) as { error?: string; relativePath?: string; size?: number };
          uploadedPath = data.relativePath ?? relativePath;
          uploadedSize = data.size ?? file!.size;
        }
        successCount++;
        setQueue((prev) =>
          prev.map((item, i) =>
            i === index
              ? {
                  ...item,
                  status: "success",
                  message: formatMessage("fileUploadDropzone.queue.completed", {
                    path: uploadedPath,
                  }),
                }
              : item,
          ),
        );
        onUploadComplete?.({
          relativePath: uploadedPath,
          size: uploadedSize,
        });
      } catch (error) {
        failureCount++;
        const errorMessage =
          error instanceof Error
            ? error.message
            : tr("fileUploadDropzone.errorUpload");
        setQueue((prev) =>
          prev.map((item, i) =>
            i === index
              ? {
                  ...item,
                  status: "error",
                  message: formatMessage("fileUploadDropzone.queue.failed", {
                    message: errorMessage,
                  }),
                }
              : item,
          ),
        );
      }
    }
    const total = uploadItems.length;
    if (total === 1 && successCount === 1) {
      setMessage({
        type: "success",
        text: formatMessage("fileUploadDropzone.summary.singleSuccess", {
          path: [baseDir, uploadItems[0]!.name].filter(Boolean).join("/"),
          size: uploadItems[0]!.size,
        }),
      });
    } else if (failureCount === 0) {
      setMessage({
        type: "success",
        text: formatMessage("fileUploadDropzone.summary.allSuccess", {
          success: successCount,
          total,
        }),
      });
    } else if (successCount > 0) {
      // Partial batch: some files failed — must not use success tone/type or
      // callers/tests treating message.type==="success" as all-good will lie.
      setMessage({
        type: "error",
        text: formatMessage("fileUploadDropzone.summary.partialSuccess", {
          success: successCount,
          total,
          failure: failureCount,
        }),
      });
    } else {
      setMessage({
        type: "error",
        text: formatMessage("fileUploadDropzone.summary.failed", {
          failure: failureCount,
          total,
        }),
      });
    }
    // The file browser owns an SPA listing and supplies a targeted refresh
    // callback. Running router.refresh() as well can race that request and
    // replace the newly selected directory with stale server props.
    if (!onUploadComplete) router.refresh();
    setSubmitting(false);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (directoryInputRef.current) {
      directoryInputRef.current.value = "";
    }
  }
  async function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    await uploadFiles(files);
  }
  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    await uploadFiles(files);
  }
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      {" "}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        {" "}
        <div>
          {" "}
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
            {title}
          </h2>{" "}
          <p className="text-sm text-[var(--text-secondary)]">
            {description}
          </p>{" "}
        </div>{" "}
      </div>{" "}
      <div
        className={`mt-5 grid gap-4 ${allowNodeSelection ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "md:grid-cols-1"}`}
      >
        {" "}
        {allowNodeSelection ? (
          <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
            {" "}
            <span>{tr("fileUploadDropzone.uploadToNode")}</span>{" "}
            <select
              aria-label={tr("fileUploadDropzone.uploadToNode")}
              value={selectedNodeId}
              onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)]"
            >
              {" "}
              <option value="">
                {" "}
                {tr("fileUploadDropzone.selectStorageNode")}{" "}
              </option>{" "}
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {" "}
                  {node.name} · {node.driver}{" "}
                </option>
              ))}{" "}
            </select>{" "}
          </label>
        ) : null}{" "}
        <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
          {" "}
          <span>{pathLabel}</span>{" "}
          <input
            aria-label={pathLabel}
            value={effectiveRelativeDir}
            readOnly={uploadDir !== undefined || !allowNodeSelection}
            onChange={(event) => setRelativeDir(event.currentTarget.value)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-[var(--text-primary)] read-only:cursor-not-allowed read-only:opacity-80"
            placeholder={tr("fileUploadDropzone.pathPlaceholder")}
          />{" "}
        </label>{" "}
      </div>{" "}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />{" "}
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={tr("fileUploadDropzone.selectFolderAriaLabel")}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={handleInputChange}
      />{" "}
      <button
        type="button"
        aria-label={submitLabel}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (uploadEnabled && !submitting) {
            setDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={handleDrop}
        disabled={!uploadEnabled || submitting}
        className={`mt-5 flex min-h-40 w-full flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-8 text-center transition ${uploadEnabled ? (dragActive ? "border-[var(--color-action-border)] bg-[var(--color-action-bg)]/10 text-[var(--color-action-fg)] dark:text-[var(--color-action-fg)]" : "border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--color-action)]/50") : "cursor-not-allowed border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-muted)]"}`}
      >
        {" "}
        <span className="text-base font-medium">{submitLabel}</span>{" "}
        <span className="mt-2 text-sm text-[var(--text-secondary)]">
          {" "}
          {uploadEnabled
            ? submitting
              ? tr("fileUploadDropzone.dropzone.uploadingHint")
              : tr("fileUploadDropzone.dropzone.readyHint")
            : uploadUnavailableHint}{" "}
        </span>{" "}
      </button>{" "}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
        {" "}
        <button
          type="button"
          onClick={() => directoryInputRef.current?.click()}
          disabled={!uploadEnabled || submitting}
          data-tone="cyan"
          className="rounded-full border border-[var(--color-action-border)]/30 px-3 py-1.5 text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {" "}
          {tr("fileUploadDropzone.selectFolder")}{" "}
        </button>{" "}
        <span>{tr("fileUploadDropzone.folderHelpText")}</span>{" "}
      </div>{" "}
      {message ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${message.type === "success" ? "border-[var(--success-border)] bg-[var(--success)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger)] text-[var(--danger)]"}`}
        >
          {" "}
          {message.text}{" "}
        </div>
      ) : null}{" "}
      {queue.length > 0 ? (
        <div className="mt-3 space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)]">
          {" "}
          {queue.map((item, index) => (
            <div
              key={`${item.name}-${index}`}
              className="flex items-center justify-between gap-3"
            >
              {" "}
              <span className="truncate">
                {" "}
                {item.name} · {item.message}{" "}
              </span>{" "}
              <span
                className={
                  item.status === "success"
                    ? "text-[var(--success)]"
                    : item.status === "error"
                      ? "text-[var(--danger)]"
                      : item.status === "uploading"
                        ? "text-[var(--color-action-fg)]"
                        : "text-[var(--text-muted)]"
                }
              >
                {" "}
                {tr(`fileUploadDropzone.status.${item.status}`)}{" "}
              </span>{" "}
            </div>
          ))}{" "}
        </div>
      ) : null}{" "}
    </section>
  );
}
