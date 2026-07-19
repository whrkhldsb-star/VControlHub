"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileTypeIcon } from "./file-entry-icons";
import { FileRowActions, FolderDownloadActionLink } from "./file-list-actions";
import { RenameInlineForm, MoveInlineForm } from "./file-row-actions";
import {
  buildForcedDownloadHref,
  formatDate,
  getPreviewHref,
  toStorageEntry,
  type FileProp,
  type StorageEntry,
} from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";

type ToastFn = (type: "success" | "error" | "info", message: string) => void;
type EntryGuard = (entry: { capabilities?: FileProp["capabilities"] }) => boolean;
type FolderGuard = (folder: FolderProp) => boolean;

export type FileListListViewMobileProps = {
  sortedFolders: FolderProp[];
  sortedFiles: FileProp[];
  emptyMessage: string;
  onGoUp?: () => void;
  effectiveSelectedIdSet: Set<string>;
  toggleOne: (id: string) => void;
  navigateToFolder: (path: string) => void;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: ToastFn;
  onOpenDetail: (id: string) => void;
  entryCanRead: EntryGuard;
  entryCanWrite: EntryGuard;
  entryCanDelete: EntryGuard;
  folderCanWrite: FolderGuard;
};

export function FileListListViewMobile(props: FileListListViewMobileProps) {
  const { t } = useI18n();
  const {
    sortedFolders,
    sortedFiles,
    emptyMessage,
    onGoUp,
    effectiveSelectedIdSet,
    toggleOne,
    navigateToFolder,
    canShare,
    canDelete,
    onRefresh,
    onNotify,
    onOpenDetail,
    entryCanRead,
    entryCanWrite,
    entryCanDelete,
    folderCanWrite,
  } = props;

  return (
    <div className="divide-y divide-[var(--border-subtle)] md:hidden">
      {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-[var(--text-muted)]">
          <p>{emptyMessage}</p>
          {onGoUp ? (
            <>
              <button
                type="button"
                onClick={onGoUp}
                data-testid="files-empty-up-level"
               data-action-button data-variant="secondary" className="mt-4 inline-flex items-center gap-1.5 !px-4 !py-2 !text-sm">
                <span aria-hidden="true">↑</span>
                {t("fileListClient.upLevel")}
              </button>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{t("fileListClient.upLevelHint")}</p>
            </>
          ) : null}
        </div>
      ) : null}

      {sortedFolders.map((folder) => (
        <div
          key={folder.path}
          className="px-4 py-3 hover:bg-[var(--surface-elevated)] transition"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--warning-bg)] p-1.5">
              <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => navigateToFolder(folder.path)}
                className="truncate font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] text-left text-sm"
              >
                {folder.displayName ?? folder.name}
              </button>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                {t("fileListClient.folderItemCount").replace(
                  "{count}",
                  String(folder.fileCount + folder.folderCount),
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigateToFolder(folder.path)}
              data-tone="cyan"
              data-action-button data-variant="secondary" className="shrink-0 !inline-flex !items-center !gap-1.5 !px-3 !py-1.5 !text-xs"
            >
              {t("fileListClient.open")}
            </button>
          </div>
          {entryCanRead(folder) || folderCanWrite(folder) ? (
            <div className="mt-2 flex flex-wrap gap-1 pl-9">
              <FolderDownloadActionLink
                folder={folder}
                entryCanRead={entryCanRead}
                compact
              />
              {folderCanWrite(folder) ? (
                <RenameInlineForm
                  fileEntryId={folder.entryId ?? ""}
                  currentName={folder.displayName ?? folder.name}
                  currentPath={folder.path}
                  entryType="DIRECTORY"
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
              {folderCanWrite(folder) && folder.entryId ? (
                <MoveInlineForm
                  fileEntryId={folder.entryId}
                  name={folder.displayName ?? folder.name}
                  relativePath={folder.path}
                  storageNodeId={folder.sourceKeys[0] ?? ""}
                  storageNodeName={folder.sourceValues[0] ?? ""}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ))}

      {sortedFiles.map((fileProp) => {
        const entry: StorageEntry = toStorageEntry(fileProp);
        const downloadUrl = buildForcedDownloadHref(entry);
        const previewHref = getPreviewHref(entry);
        const isChecked = effectiveSelectedIdSet.has(fileProp.id);

        return (
          <div
            key={entry.id}
            className={`px-4 py-3 ${isChecked ? "bg-[var(--color-action-bg)]/[0.04]" : ""}`}
          >
            <div className="flex items-start gap-3">
              {entryCanWrite(entry) || entryCanDelete(entry) ? (
                <input
                  type="checkbox"
                  checked={effectiveSelectedIdSet.has(entry.id)}
                  aria-label={t("fileListClient.selectFileAria").replace("{name}", entry.name)}
                  onChange={() => toggleOne(entry.id)}
                  className="mt-2 h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--surface)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]"
                />
              ) : null}
              <div className="shrink-0 mt-0.5 rounded-lg bg-[var(--surface-elevated)] p-1">
                <FileTypeIcon entry={entry} size={22} />
              </div>
              <div className="min-w-0 flex-1">
                {entry.previewable && entryCanRead(entry) ? (
                  <Link
                    href={previewHref}
                    className="truncate font-medium text-[var(--text-primary)] text-sm hover:text-[var(--text-primary)] transition"
                  >
                    {entry.name}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-[var(--text-primary)] text-sm">
                    {entry.name}
                  </span>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                  <span>{entry.sizeLabel}</span>
                  <span>{entry.storageNode.name}</span>
                  {entry.updatedAt ? <span>{formatDate(entry.updatedAt)}</span> : null}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 pl-9">
              <FileRowActions
                entry={entry}
                downloadUrl={downloadUrl}
                previewHref={previewHref}
                compact
                canShare={canShare}
                canDelete={canDelete}
                onRefresh={onRefresh}
                onNotify={onNotify}
                onOpenDetail={onOpenDetail}
                entryCanRead={entryCanRead}
                entryCanWrite={entryCanWrite}
                entryCanDelete={entryCanDelete}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
