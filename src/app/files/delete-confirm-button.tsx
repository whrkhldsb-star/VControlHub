"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/action-button";
import { SubmitButton } from "@/components/submit-button";
import { useI18n } from "@/lib/i18n/use-locale";
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
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteFileEntryAction,
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

  function handleCancel() {
    setConfirming(false);
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
      setConfirming(false);
      onRefreshRef.current?.();
      window.setTimeout(() => window.location.reload(), 250);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pending, state.error]);

  useEffect(() => {
    if (!state.error) return;
    onNotify?.("error", state.error);
  }, [onNotify, state.error]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={t("common.delete")}
        aria-label={t("filesPage.actions.deleteAria", { name: entryName })}
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
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
        {variant === "menu" ? <span>{t("common.delete")}</span> : null}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => { submittedRef.current = true; }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="fileEntryId" value={fileEntryId} />
      <span className="text-sm text-[var(--danger)]">
        {t("filesPage.actions.confirmDelete", { name: entryName, contents: entryType === "DIRECTORY" ? t("filesPage.actions.directoryContents") : "" })}
      </span>
      <SubmitButton
        pendingLabel={t("common.confirm")}
        variant="danger"
      >
        {t("common.confirm")}
      </SubmitButton>
      <ActionButton
        type="button"
        variant="secondary"
        onClick={handleCancel}
        className="!px-4 !py-2 !text-sm"
      >
        {t("common.cancel")}
      </ActionButton>
    </form>
  );
}
