"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  renameFileEntryAction,
  type StorageActionState,
} from "../storage/actions";

const initialState: StorageActionState = {};

export function RenameInlineForm({
  fileEntryId,
  currentName,
  currentPath,
  variant = "icon",
  onRefresh,
  onNotify,
}: {
  fileEntryId: string;
  currentName: string;
  currentPath: string;
  entryType: "FILE" | "DIRECTORY";
  variant?: "icon" | "menu";
  onRefresh?: () => void;
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, formAction] = useActionState(
    renameFileEntryAction,
    initialState,
  );

  function handleToggle() {
    setEditing(true);
    setNewName(currentName);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleCancel() {
    setEditing(false);
    setNewName(currentName);
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
        title="重命名"
        aria-label={`重命名 ${currentName}`}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-amber-100 transition hover:bg-amber-400/10 light:text-amber-900"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-100 transition hover:bg-amber-400/20 light:text-amber-900"
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
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
        {variant === "menu" ? <span>重命名</span> : null}
      </button>
    );
  }

  const lastSlashIndex = currentPath.lastIndexOf("/");
  const pathPrefix =
    lastSlashIndex >= 0 ? currentPath.substring(0, lastSlashIndex + 1) : "";
  const previewPath = newName.trim()
    ? `${pathPrefix}${newName.trim()}`
    : currentPath;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      {" "}
      <input type="hidden" name="fileEntryId" value={fileEntryId} />{" "}
      <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
        {" "}
        <span className="sr-only">新名称</span>{" "}
        <input
          ref={inputRef}
          name="newName"
          value={newName}
          onChange={(event) => setNewName(event.currentTarget.value)}
          required
          minLength={1}
          maxLength={255}
          pattern={String.raw`^[^\s/\\:*?"<>|]+$`}
          placeholder="输入新名称"
          className="rounded-2xl border border-[var(--border)] bg-slate-950 light:bg-white px-4 py-2 text-sm text-white placeholder:text-slate-500 light:placeholder:text-slate-400"
        />
      </label>
      {newName.trim() && newName !== currentName ? (
        <span className="text-xs text-[var(--text-secondary)]">
          路径：/{previewPath}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={!newName.trim() || newName === currentName}
        data-tone="accent"
        className="rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        确认
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
      >
        取消
      </button>
    </form>
  );
}
