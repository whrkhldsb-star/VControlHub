"use client";

/**
 * Grid view — large icon tiles for the file list.
 *
 * Extracted from file-list-client.tsx in R31. Renders folder cards
 * (single-click navigation) above file cards (with thumbnail / icon,
 * checkbox, action bar). All capability gates live in the shared
 * `FileRowActions` and `file-list-model` helpers; this component is
 * purely layout.
 */
import Link from "next/link";

import { FileTypeIcon } from "./file-entry-icons";
import { FileRowActions } from "./file-list-actions";
import {
  buildForcedDownloadHref,
  getPreviewHref,
  getThumbnailUrl,
  toStorageEntry,
  type FileProp,
  type StorageEntry,
} from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";

type ToastFn = (type: "success" | "error" | "info", message: string) => void;
type EntryGuard = (entry: { capabilities?: FileProp["capabilities"] }) => boolean;

export type FileListGridViewProps = {
  sortedFolders: FolderProp[];
  sortedFiles: FileProp[];
  emptyMessage: string;
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
};

export function FileListGridView({
  sortedFolders,
  sortedFiles,
  emptyMessage,
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
}: FileListGridViewProps) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
        <div className="col-span-full py-16 text-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="mx-auto mb-3 text-[var(--text-muted)]"
          >
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
        </div>
      ) : null}

      {/* Folder cards */}
      {sortedFolders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          onClick={() => navigateToFolder(folder.path)}
          data-testid="folder-card"
          className="group flex min-h-[156px] flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center transition-colors duration-150 hover:border-[var(--warning-border)] hover:bg-[var(--warning)]0/[0.04]"
        >
          <div
            className="rounded-xl bg-[var(--warning-bg)] p-3 transition-colors group-hover:bg-[var(--warning-bg)]"
            aria-hidden="true"
          >
            <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={36} />
          </div>
          <span className="w-full truncate text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)] transition">
            {folder.displayName ?? folder.name}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {folder.fileCount + folder.folderCount} 项
          </span>
        </button>
      ))}

      {/* File cards */}
      {sortedFiles.map((fileProp) => {
        const entry: StorageEntry = toStorageEntry(fileProp);
        const thumbUrl = getThumbnailUrl(entry);
        const downloadUrl = buildForcedDownloadHref(entry);
        const previewHref = getPreviewHref(entry);
        const isChecked = effectiveSelectedIdSet.has(fileProp.id);

        return (
          <div
            key={entry.id}
            className={`group relative flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-center transition-colors duration-200 hover:border-[var(--color-action-border)]/20 hover:shadow-lg hover:shadow-[var(--color-action)]/5 overflow-hidden ${isChecked ? "ring-2 ring-[var(--color-action-ring)] bg-[var(--color-action-bg)]/[0.04] light:bg-[var(--color-action-bg)]" : ""}`}
          >
            {/* Selection checkbox */}
            <div className="absolute top-2 left-2 z-20">
              {entryCanWrite(entry) || entryCanDelete(entry) ? (
                <input
                  type="checkbox"
                  checked={effectiveSelectedIdSet.has(entry.id)}
                  onChange={() => toggleOne(entry.id)}
                  aria-label={`选择 ${entry.name}`}
                  className="h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--surface)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]/50"
                />
              ) : null}
            </div>

            {/* Thumbnail / icon area */}
            <div className="relative flex items-center justify-center pt-6 pb-2 px-4">
              {thumbUrl ? (
                <div
                  data-testid="file-thumbnail-overlay"
                  className="w-full h-28 rounded-xl overflow-hidden border border-[var(--border)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl}
                    alt={entry.name}
                    width={224}
                    height={112}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="rounded-xl bg-[var(--surface)]/[0.04] p-4">
                  <FileTypeIcon entry={entry} size={44} />
                </div>
              )}
            </div>

            {/* File name & meta */}
            <div className="px-4 pb-2 flex-1 flex flex-col">
              {entry.previewable && entryCanRead(entry) ? (
                <Link
                  href={previewHref}
                  className="w-full truncate text-sm font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] transition"
                >
                  {entry.name}
                </Link>
              ) : (
                <span className="w-full truncate text-sm font-medium text-[var(--text-primary)]">
                  {entry.name}
                </span>
              )}
              <div className="mt-1 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <span>{entry.sizeLabel}</span>
                <span className="text-[var(--text-disabled)]">·</span>
                <span className="truncate">{entry.storageNode.name}</span>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-[var(--border)] bg-[var(--surface-subtle)]">
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
