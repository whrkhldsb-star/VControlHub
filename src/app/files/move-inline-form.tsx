"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { type MoveFileActionState, moveFileAction } from "./move-file-action";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { ActionButton } from "@/components/action-button";
const initialState: MoveFileActionState = {};

export function MoveInlineForm({
  fileEntryId,
  name,
  relativePath,
  variant = "icon",
  onRefresh,
  onNotify,
}: {
  fileEntryId: string;
  name: string;
  relativePath: string;
  variant?: "icon" | "menu";
  onRefresh?: () => void;
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [targetDir, setTargetDir] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);
  const handledSuccessRef = useRef<string | null>(null);
  const [state, formAction, pending] = useActionState(moveFileAction, initialState);
  const onNotifyRef = useRef(onNotify);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onNotifyRef.current = onNotify;
    onRefreshRef.current = onRefresh;
  }, [onNotify, onRefresh]);

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
    if (!state.success) {
      handledSuccessRef.current = null;
      return;
    }
    if (handledSuccessRef.current === state.success) return;
    handledSuccessRef.current = state.success;
    onNotifyRef.current?.("success", state.success);
  }, [state.success]);

  useEffect(() => {
    if (pending || !submittedRef.current) return;
    const timer = window.setTimeout(() => {
      submittedRef.current = false;
      if (state.error) return;
      setEditing(false);
      onRefreshRef.current?.();
      window.setTimeout(() => window.location.reload(), 250);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pending, state.error]);

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
        aria-label={t("filesPage.actions.moveAria", { name })}
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
    <form
      action={formAction}
      onSubmit={() => { submittedRef.current = true; }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
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
      <ActionButton variant="outline"
        type="submit"
        disabled={pending || !targetDir.trim() || targetDir.trim() === currentDir} className="!px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? t("common.executing") : t("common.confirm")}
      </ActionButton>
      <ActionButton variant="secondary"
        onClick={handleCancel}
        disabled={pending} className="!px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50">
        {t("common.cancel")}
      </ActionButton>
    </form>
  );
}
