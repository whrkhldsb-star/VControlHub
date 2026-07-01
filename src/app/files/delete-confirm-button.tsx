"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deleteFileEntryAction,
  type StorageActionState,
} from "../storage/actions";

const initialState: StorageActionState = {};

export function DeleteConfirmButton({
  fileEntryId,
  entryName,
  entryType,
  variant = "icon",
  onRefresh,
  onNotify,
}: {
  fileEntryId: string;
  entryName: string;
  entryType: "FILE" | "DIRECTORY";
  variant?: "icon" | "menu";
  onRefresh?: () => void;
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(
    deleteFileEntryAction,
    initialState,
  );

  function handleCancel() {
    setConfirming(false);
  }

  useEffect(() => {
    if (!state.success) return;
    onNotify?.("success", state.success);
    if (onRefresh) {
      onRefresh();
    } else {
      router.refresh();
    }
  }, [onNotify, onRefresh, router, state.success]);

  useEffect(() => {
    if (!state.error) return;
    onNotify?.("error", state.error);
  }, [onNotify, state.error]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="删除"
        aria-label={`删除 ${entryName}`}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rose-100 transition hover:bg-rose-400/10"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-100 transition hover:bg-rose-400/20"
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
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
        {variant === "menu" ? <span>删除</span> : null}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <span className="text-sm text-rose-200">
        确认删除 {entryName}
        {entryType === "DIRECTORY" ? " 及其内容" : ""}？
      </span>
      <button
        type="submit"
        data-tone="rose" className="rounded-full border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
      >
        确认
      </button>
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-full border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
      >
        取消
      </button>
    </form>
  );
}
