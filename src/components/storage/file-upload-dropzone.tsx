"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type StorageUploadNode = { id: string; name: string; driver: string };

type UploadMessage = { type: "success" | "error"; text: string } | null;
type UploadQueueItem = { name: string; status: "pending" | "uploading" | "success" | "error"; message: string };
type BrowserFileWithRelativePath = File & { webkitRelativePath?: string };

type PathResult = { ok: true; path: string } | { ok: false; reason: string };

const DEFAULT_NODE = "";
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const DANGEROUS_CHAR_PATTERN = /[<>:"|?*]/;
const MAX_SEGMENT_LENGTH = 255;
const MAX_PATH_LENGTH = 4096;

function normalizeRelativePath(input: string): PathResult {
  const value = input.trim();
  if (!value) {
    return { ok: true, path: "" };
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return { ok: false, reason: "路径包含控制字符" };
  }
  if (DANGEROUS_CHAR_PATTERN.test(value)) {
    return { ok: false, reason: "路径包含非法字符" };
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return { ok: false, reason: "路径必须是相对路径" };
  }

  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "路径不能包含 . 或 .." };
  }
  if (segments.some((segment) => segment.length > MAX_SEGMENT_LENGTH)) {
    return { ok: false, reason: "路径段过长" };
  }

  const path = segments.join("/");
  if (path.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: "路径过长" };
  }
  return { ok: true, path };
}


function getBrowserRelativePath(file: File) {
  const browserFile = file as BrowserFileWithRelativePath;
  return browserFile.webkitRelativePath?.trim() || file.name;
}

function getUploadDisplayPath(file: File) {
  return getBrowserRelativePath(file);
}

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
  onUploadComplete?: (payload: { relativePath?: string; size?: number }) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(initialNodeId ?? nodes.find((node) => node.driver === "LOCAL")?.id ?? DEFAULT_NODE);
  const [relativeDir, setRelativeDir] = useState(initialRelativeDir);
  const effectiveRelativeDir = uploadDir ?? relativeDir;
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<UploadMessage>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const uploadEnabled = selectedNode ? ["LOCAL", "SFTP"].includes(selectedNode.driver) : false;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const nextNodeId = initialNodeId ?? nodes.find((node) => node.driver === "LOCAL")?.id ?? DEFAULT_NODE;
    setSelectedNodeId(nextNodeId);
  }, [initialNodeId, nodes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function uploadFiles(files: File[]) {
    if (!selectedNodeId) {
      setMessage({ type: "error", text: "请先选择存储节点。" });
      return;
    }

    if (!uploadEnabled) {
      setMessage({ type: "error", text: "请选择 LOCAL 或 SFTP 存储节点后再上传。" });
      return;
    }

    const uploadItems = files.filter((file) => file.size >= 0);
    if (uploadItems.length === 0) return;

	const baseDirResult = normalizeRelativePath(effectiveRelativeDir);
	if (!baseDirResult.ok) { setMessage({ type: "error", text: baseDirResult.reason }); setSubmitting(false); return; }
	const baseDir = baseDirResult.path;
    setSubmitting(true);
    setMessage(null);
    setQueue(uploadItems.map((file) => ({ name: getUploadDisplayPath(file), status: "pending", message: "等待上传" })));

    let successCount = 0;
    let failureCount = 0;

    for (let index = 0; index < uploadItems.length; index++) {
      const file = uploadItems[index];
      const itemPathResult = normalizeRelativePath(getBrowserRelativePath(file));
      if (!itemPathResult.ok) {
        failureCount++;
        setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, status: "error", message: `失败：${itemPathResult.reason}` } : item)));
        continue;
      }
      const relativePath = [baseDir, itemPathResult.path].filter(Boolean).join("/");
      const formData = new FormData();
      formData.set("storageNodeId", selectedNodeId);
      formData.set("relativePath", relativePath);
      formData.set("file", file);

      setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, status: "uploading", message: "上传中…" } : item)));

	try {
 const data = await csrfFetch("/api/storage/local", {
 method: "POST",
 body: formData,
 }) as { error?: string; relativePath?: string; size?: number };

 successCount++;
 setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, status: "success", message: `完成：${data.relativePath ?? relativePath}` } : item)));
 onUploadComplete?.({ relativePath: data.relativePath ?? relativePath, size: data.size ?? file.size });
      } catch (error) {
        failureCount++;
        const errorMessage = error instanceof Error ? error.message : "上传失败";
        setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, status: "error", message: `失败：${errorMessage}` } : item)));
      }
    }

    const total = uploadItems.length;
    if (total === 1 && successCount === 1) {
      setMessage({ type: "success", text: `上传完成：${[baseDir, uploadItems[0].name].filter(Boolean).join("/")}（${uploadItems[0].size} B）` });
    } else if (failureCount === 0) {
      setMessage({ type: "success", text: `上传完成 ${successCount}/${total} 个文件` });
    } else if (successCount > 0) {
      setMessage({ type: "success", text: `上传完成 ${successCount}/${total} 个文件，${failureCount} 个失败` });
    } else {
      setMessage({ type: "error", text: `上传失败：${failureCount}/${total} 个文件未上传` });
    }

    router.refresh();
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
    <section className="rounded-3xl border border-[var(--border)] bg-slate-900/60 light:bg-white/60 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        </div>
      </div>

      <div className={`mt-5 grid gap-4 ${allowNodeSelection ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "md:grid-cols-1"}`}>
        {allowNodeSelection ? (
          <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
            <span>上传到节点</span>
            <select
              aria-label="上传到节点"
              value={selectedNodeId}
              onChange={(event) => setSelectedNodeId(event.currentTarget.value)}
              className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-3 text-white"
            >
              <option value="">请选择存储节点</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} · {node.driver}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="grid gap-2 text-sm text-[var(--text-secondary)]">
          <span>{pathLabel}</span>
          <input
            aria-label={pathLabel}
            value={effectiveRelativeDir}
            readOnly={uploadDir !== undefined || !allowNodeSelection}
            onChange={(event) => setRelativeDir(event.currentTarget.value)}
            className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-3 text-white read-only:cursor-not-allowed read-only:opacity-80"
            placeholder="docs 或 media/videos"
          />
        </label>
      </div>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleInputChange} />
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="选择整个文件夹"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={handleInputChange}
      />

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
        className={`mt-5 flex min-h-40 w-full flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-8 text-center transition ${
          uploadEnabled
            ? dragActive
              ? "border-cyan-300 bg-cyan-400/10 text-cyan-100"
              : "border-white/15 bg-white/5 text-slate-100 hover:border-cyan-400/50"
            : "cursor-not-allowed border-[var(--border)] bg-slate-950/60 light:bg-slate-50 text-slate-500"
        }`}
      >
        <span className="text-base font-medium">{submitLabel}</span>
        <span className="mt-2 text-sm text-[var(--text-secondary)]">
          {uploadEnabled ? (submitting ? "上传中，请稍候..." : "可拖拽或选择多个文件上传，文件夹请切换下方模式。") : "请选择 LOCAL 或 SFTP 节点后再上传。"}
        </span>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
        <button
          type="button"
          onClick={() => directoryInputRef.current?.click()}
          disabled={!uploadEnabled || submitting}
          className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          选择文件夹
        </button>
        <span>主按钮可多选文件；文件夹模式会保留浏览器提供的子目录结构。</span>
      </div>

      {message ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-rose-400/30 bg-rose-400/10 text-rose-100"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {queue.length > 0 ? (
        <div className="mt-3 space-y-1 rounded-2xl border border-[var(--border)] bg-slate-950/50 light:bg-white/50 p-3 text-xs text-[var(--text-secondary)]">
          {queue.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3">
              <span className="truncate">
                {item.name} · {item.message}
              </span>
              <span
                className={
                  item.status === "success"
                    ? "text-emerald-200"
                    : item.status === "error"
                      ? "text-rose-200"
                      : item.status === "uploading"
                        ? "text-cyan-200"
                        : "text-slate-400"
                }
              >
                {item.status === "success" ? "完成" : item.status === "error" ? "失败" : item.status === "uploading" ? "上传中" : "等待"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
