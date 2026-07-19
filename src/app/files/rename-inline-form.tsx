"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  renameFileEntryAction,
  type StorageActionState,
} from "../storage/actions";
import { useI18n } from "@/lib/i18n/use-locale";

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
  const { t } = useI18n();
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
        title={t("renameInlineForm.rename")}
        aria-label={`${t("renameInlineForm.rename")} ${currentName}`}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--warning)] transition hover:bg-[var(--warning-bg)]"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] transition hover:bg-[var(--warning-bg)]"
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
        {variant === "menu" ? <span>{t("renameInlineForm.rename")}</span> : null}
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
        <span className="sr-only">{t("renameInlineForm.newName")}</span>{" "}
        <input
          ref={inputRef}
          name="newName"
          value={newName}
          onChange={(event) => setNewName(event.currentTarget.value)}
          required
          minLength={1}
          maxLength={255}
          pattern={String.raw`^[^\s/\\:*?"<>|]+$`}
          placeholder={t("renameInlineForm.inputPlaceholder")}
          className="rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </label>
      {newName.trim() && newName !== currentName ? (
        <span className="text-xs text-[var(--text-secondary)]">
          {t("renameInlineForm.pathPrefix")}/{previewPath}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={!newName.trim() || newName === currentName}
        data-tone="accent"
        data-action-button data-variant="primary" className="disabled:opacity-50"
      >
        {t("renameInlineForm.confirm")}
      </button>
      <button
        type="button"
        onClick={handleCancel}
       data-action-button data-variant="secondary" className="!px-4 !py-2 !text-sm">
        {t("renameInlineForm.cancel")}
      </button>
    </form>
  );
}
