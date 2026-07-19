"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { type MoveFileActionState, moveFileAction } from "./move-file-action";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
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
  const { t } = useI18n();
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
        title={t("common.move")}
        aria-label={t("filesPage.actions.moveAria").replace("{name}", name)}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--success)] transition hover:bg-[var(--success-bg)]"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)] transition hover:bg-[var(--success-bg)]"
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
        {variant === "menu" ? <span>{t("common.move")}</span> : null}
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
        <span className="sr-only">{t("filesPage.actions.targetPath")}</span>
        <input
          ref={inputRef}
          name="targetDir"
          value={targetDir}
          onChange={(event) => setTargetDir(event.currentTarget.value)}
          required
          minLength={1}
          placeholder={currentDir || t("filesPage.actions.targetPath")}
          className={cn(UI_INPUT, "rounded-2xl py-1.5 text-xs")}
        />
      </label>
      <span className="text-xs text-[var(--text-secondary)]">
        → /{previewPath}
      </span>
      <button
        type="submit"
        disabled={!targetDir.trim() || targetDir.trim() === currentDir}
       data-action-button data-variant="outline" className="!px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50">
        {t("common.confirm")}
      </button>
      <button
        type="button"
        onClick={handleCancel}
       data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-xs">
        {t("common.cancel")}
      </button>
    </form>
  );
}
