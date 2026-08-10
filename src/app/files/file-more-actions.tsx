"use client";

/**
 * FileMoreActions — the"更多" details/summary dropdown that hosts
 * secondary entry actions (share / rename / move / delete).
 *
 * Extracted from `file-list-client.tsx` (TR-036 T36b) so the parent
 * chunk does not pull in `ShareFileButton` / `RenameInlineForm` /
 * `MoveInlineForm` / `DeleteConfirmButton` until the user actually
 * expands a menu. The wrapping `FileMoreActionsLazy` uses
 * `next/dynamic` to defer the chunk.
 */
import {
  DeleteConfirmButton,
  RenameInlineForm,
  MoveInlineForm,
  ShareFileButton,
} from "./file-row-actions";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StorageEntry } from "./file-entry-utils";
import { useI18n } from "@/lib/i18n/use-locale";

type FileMoreActionsProps = {
  entry: StorageEntry;
  compact?: boolean;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify?: (type:"success" |"error" |"info", message: string) => void;
  // read/write/delete capability checks. The parent supplies these so
  // this chunk doesn't have to re-import the model layer (which would
  // defeat the lazy-load goal).
  entryCanRead: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanWrite: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanDelete: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
};

export function FileMoreActions({
  entry,
  compact = false,
  canShare,
  canDelete,
  onRefresh,
  onNotify,
  entryCanRead,
  entryCanWrite,
  entryCanDelete,
}: FileMoreActionsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  // Keep menu chrome and ShareFileButton gated by the same rule (Share is FILE-only).
  const canShowShare =
    canShare && entryCanRead(entry) && entry.entryType === "FILE";
  const hasMoreActions =
    canShowShare ||
    entryCanWrite(entry) ||
    (canDelete && entryCanDelete(entry));

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuWidth = menuRef.current?.offsetWidth || 176;
    const menuHeight = menuRef.current?.offsetHeight || 184;
    const viewportMargin = 8;
    const gap = 6;
    const availableBelow = window.innerHeight - triggerRect.bottom - gap - viewportMargin;
    const availableAbove = triggerRect.top - gap - viewportMargin;
    const openUpward = availableBelow < Math.min(menuHeight, 160) && availableAbove > availableBelow;
    const availableHeight = Math.max(
      96,
      openUpward ? availableAbove : availableBelow,
    );
    const visibleHeight = Math.min(menuHeight, availableHeight);
    const top = openUpward
      ? Math.max(viewportMargin, triggerRect.top - gap - visibleHeight)
      : Math.min(
          triggerRect.bottom + gap,
          window.innerHeight - viewportMargin - visibleHeight,
        );
    const left = Math.min(
      Math.max(viewportMargin, triggerRect.right - menuWidth),
      Math.max(viewportMargin, window.innerWidth - viewportMargin - menuWidth),
    );

    setPosition({ top, left, maxHeight: availableHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleViewportChange);
    if (menuRef.current) observer?.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      observer?.disconnect();
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!hasMoreActions) return null;
  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={t("fileMoreActions.more")}
        aria-label={`${t("fileMoreActions.more")} ${entry.name}`}
        aria-expanded={open}
        aria-haspopup="true"
        className={
          compact
            ?"inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)]"
            :"inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)]"
        }
      >
        <span aria-hidden="true">⋯</span>
        {compact ? null : <span>{t("fileMoreActions.more")}</span>}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
      <div
        ref={menuRef}
        role="group"
        aria-label={`${t("fileMoreActions.more")} ${entry.name}`}
        style={{
          position: "fixed",
          top: position ? `${position.top}px` : "0px",
          left: position ? `${position.left}px` : "0px",
          maxHeight: position ? `${position.maxHeight}px` : "calc(100vh - 16px)",
          visibility: position ? "visible" : "hidden",
        }}
        className="z-[9999] flex min-w-44 max-w-[calc(100vw-1rem)] flex-col gap-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-2 text-left shadow-2xl shadow-black/40 light:shadow-[var(--border)]/30"
      >
        {canShowShare ? (
          <ShareFileButton entry={entry} compact variant="menu" onNotify={onNotify} />
        ) : null}
        {entryCanWrite(entry) ? (
          <RenameInlineForm
            fileEntryId={entry.id}
            currentName={entry.name}
            currentPath={entry.relativePath}
            variant="menu"
            onRefresh={onRefresh}
            onNotify={onNotify}
          />
        ) : null}
        {entryCanWrite(entry) ? (
          <MoveInlineForm
            fileEntryId={entry.id}
            name={entry.name}
            relativePath={entry.relativePath}
            variant="menu"
            onRefresh={onRefresh}
            onNotify={onNotify}
          />
        ) : null}
        {canDelete && entryCanDelete(entry) ? (
          <DeleteConfirmButton
            fileEntryId={entry.id}
            entryName={entry.name}
            entryType={entry.entryType as"FILE" |"DIRECTORY"}
            variant="menu"
            onRefresh={onRefresh}
            onNotify={onNotify}
          />
        ) : null}
      </div>,
          document.body,
        )
        : null}
    </span>
  );
}
