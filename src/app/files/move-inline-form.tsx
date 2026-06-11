"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { type MoveFileActionState, moveFileAction } from "./move-file-action";

const initialState: MoveFileActionState = {};

export function MoveInlineForm({
  fileEntryId,
  name,
  relativePath,
  storageNodeId,
  variant = "icon",
  onRefresh,
  onNotify,
}: {
  fileEntryId: string;
  name: string;
  relativePath: string;
  storageNodeId: string;
  storageNodeName: string;
  variant?: "icon" | "menu";
  onRefresh?: () => void;
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [targetDir, setTargetDir] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, formAction] = useActionState(moveFileAction, initialState);

  function handleToggle() {
    setEditing(true);
    setTargetDir("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleCancel() {
    setEditing(false);
    setTargetDir("");
  }

  useEffect(() => {
    if (!state.success) return;
    onNotify?.("success", state.success);
    const t = setTimeout(() => {
      setEditing(false);
      if (onRefresh) {
        onRefresh();
      } else {
        router.refresh();
      }
    }, 250);
    return () => clearTimeout(t);
  }, [state.success, onNotify, onRefresh, router]);

  useEffect(() => {
    if (!state.error) return;
    onNotify?.("error", state.error);
  }, [state.error, onNotify]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        title="移动"
        aria-label={`移动 ${name}`}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-emerald-100 transition hover:bg-emerald-400/10 light:text-emerald-900"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-100 transition hover:bg-emerald-400/20 light:text-emerald-900"
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
        {variant === "menu" ? <span>移动</span> : null}
      </button>
    );
  }

  const lastSlashIndex = relativePath.lastIndexOf("/");
  const currentDir =
    lastSlashIndex >= 0 ? relativePath.substring(0, lastSlashIndex) : "";
  const previewPath = targetDir.trim()
    ? `${targetDir.trim()}/${name}`
    : relativePath;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <input type="hidden" name="currentRelativePath" value={relativePath} />
      <input type="hidden" name="storageNodeId" value={storageNodeId} />
      <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
        <span className="sr-only">目标路径</span>
        <input
          ref={inputRef}
          name="targetDir"
          value={targetDir}
          onChange={(event) => setTargetDir(event.currentTarget.value)}
          required
          minLength={1}
          placeholder={currentDir || "目标路径"}
          className="rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white px-3 py-1.5 text-xs text-white placeholder:text-slate-500 light:placeholder:text-slate-400 focus:border-cyan-400/50 focus:outline-none"
        />
      </label>
      <span className="text-xs text-[var(--text-secondary)]">
        → /{previewPath}
      </span>
      <button
        type="submit"
        disabled={!targetDir.trim() || targetDir.trim() === currentDir}
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        确认
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
      >
        取消
      </button>
    </form>
  );
}
