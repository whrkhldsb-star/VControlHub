"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  renameFileEntryAction,
  type StorageActionState,
} from "../storage/actions";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";

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
  variant?: "icon" | "menu";
  onRefresh?: () => void;
  onNotify?: (type: "success" | "error" | "info", message: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, formAction, pending] = useActionState(
    renameFileEntryAction,
    initialState,
  );
  const submittedRef = useRef(false);
  const handledSuccessRef = useRef<string | null>(null);
  const onNotifyRef = useRef(onNotify);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onNotifyRef.current = onNotify;
    onRefreshRef.current = onRefresh;
  }, [onNotify, onRefresh]);
  const canRename = Boolean(fileEntryId?.trim());

  function handleToggle() {
    if (!canRename) return;
    setEditing(true);
    setNewName(currentName);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleCancel() {
    setEditing(false);
    setNewName(currentName);
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

  if (!canRename) {
    return null;
  }

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
    <form
      action={formAction}
      onSubmit={() => { submittedRef.current = true; }}
      className="flex flex-wrap items-center gap-3"
    >
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
          className="rounded-2xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </label>
      {newName.trim() && newName !== currentName ? (
        <span className="text-xs text-[var(--text-secondary)]">
          {t("renameInlineForm.pathPrefix")}/{previewPath}
        </span>
      ) : null}
      <ActionButton variant="primary"
        type="submit"
        disabled={pending || !newName.trim() || newName === currentName}
        data-tone="accent" className="disabled:opacity-50"
      >
        {t("renameInlineForm.confirm")}
      </ActionButton>
      <ActionButton variant="secondary"
        onClick={handleCancel} className="!px-4 !py-2 !text-sm">
        {t("renameInlineForm.cancel")}
      </ActionButton>
    </form>
  );
}
