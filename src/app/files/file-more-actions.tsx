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
  const hasMoreActions =
    (canShare && entryCanRead(entry) && entry.entryType ==="FILE") ||
    entryCanWrite(entry) ||
    (canDelete && entryCanDelete(entry));
  if (!hasMoreActions) return null;
  return (
    <details className="relative inline-flex group/more">
      <summary
        role="button"
        title={t("fileMoreActions.more")}
        aria-label={`${t("fileMoreActions.more")} ${entry.name}`}
        className={
          compact
            ?"inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden"
            :"inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden"
        }
      >
        <span aria-hidden="true">⋯</span>
        {compact ? null : <span>{t("fileMoreActions.more")}</span>}
      </summary>
      <div className="absolute right-0 top-9 z-40 flex min-w-44 flex-col gap-1 rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-2 text-left shadow-2xl shadow-black/40 light:shadow-[var(--border)]/30">
        {canShare && entryCanRead(entry) ? (
          <ShareFileButton entry={entry} compact variant="menu" onNotify={onNotify} />
        ) : null}
        {entryCanWrite(entry) ? (
          <RenameInlineForm
            fileEntryId={entry.id}
            currentName={entry.name}
            currentPath={entry.relativePath}
            entryType={entry.entryType as"FILE" |"DIRECTORY"}
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
            storageNodeId={entry.storageNode.id}
            storageNodeName={entry.storageNode.name}
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
      </div>
    </details>
  );
}
