"use client";

/**
 * Details view — card rows with thumbnails + clear action buttons.
 *
 * Extracted from file-list-client.tsx in R31. One card per folder/file,
 * stacked vertically with a divider. Used when the user prefers a
 * scannable layout with more metadata than the grid view but less
 * density than the spreadsheet-style list view.
 */
import Link from "next/link";

import { FileTypeIcon } from "./file-entry-icons";
import {
  FolderDownloadActionLink,
  FileRowActions,
} from "./file-list-actions";
import { RenameInlineForm, MoveInlineForm } from "./file-row-actions";
import {
  buildForcedDownloadHref,
  formatDate,
  getPreviewHref,
  getThumbnailUrl,
  toStorageEntry,
  type FileProp,
  type StorageEntry,
} from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";

type ToastFn = (type: "success" | "error" | "info", message: string) => void;
type EntryGuard = (entry: { capabilities?: FileProp["capabilities"] }) => boolean;
type FolderGuard = (folder: FolderProp) => boolean;

export type FileListDetailsViewProps = {
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
  folderCanWrite: FolderGuard;
};

export function FileListDetailsView({
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
  folderCanWrite,
}: FileListDetailsViewProps) {
  return (
    <div className="divide-y divide-white/[0.04] light:divide-[var(--border)]">
      {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>
        </div>
      ) : null}

      {/* Details folder rows */}
      {sortedFolders.map((folder) => (
        <div
          key={folder.path}
          className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface)]/[0.04] transition group"
        >
          <div className="shrink-0">
            <div className="rounded-xl bg-[var(--warning-bg)] p-2">
              <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={28} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigateToFolder(folder.path)}
              className="truncate font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)] transition text-left text-sm"
            >
              {folder.displayName ?? folder.name}
            </button>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>目录</span>
              <span>{folder.fileCount + folder.folderCount} 项</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigateToFolder(folder.path)}
              data-tone="cyan"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border border-[var(--color-action-border)]/30 text-[var(--text-primary)] hover:bg-[var(--color-action)]/25 hover:border-[var(--color-action-border)]/50 transition"
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
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              打开
            </button>
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
            <FolderDownloadActionLink
              folder={folder}
              entryCanRead={entryCanRead}
            />
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
        </div>
      ))}

      {/* Details file rows */}
      {sortedFiles.map((fileProp) => {
        const entry: StorageEntry = toStorageEntry(fileProp);
        const downloadUrl = buildForcedDownloadHref(entry);
        const previewHref = getPreviewHref(entry);
        const thumbUrl = getThumbnailUrl(entry);
        const isChecked = effectiveSelectedIdSet.has(fileProp.id);

        return (
          <div
            key={entry.id}
            className={`flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface)]/[0.04] transition ${isChecked ? "bg-[var(--color-action-bg)]/[0.04]" : ""}`}
          >
            {/* Checkbox */}
            <div className="shrink-0">
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

            {/* Thumbnail or colored icon */}
            <div className="shrink-0 w-12 h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex items-center justify-center">
              {thumbUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={thumbUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <FileTypeIcon entry={entry} size={28} />
              )}
            </div>

            {/* File info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {entry.previewable && entryCanRead(entry) ? (
                  <Link
                    href={previewHref}
                    className="truncate font-medium text-[var(--text-primary)] hover:text-[var(--text-primary)] transition text-sm"
                  >
                    {entry.name}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-[var(--text-primary)] text-sm">
                    {entry.name}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>{entry.sizeLabel}</span>
                <span>{entry.storageNode.name}</span>
                {entry.updatedAt ? (
                  <span>{formatDate(entry.updatedAt)}</span>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="shrink-0">
              <FileRowActions
                entry={entry}
                downloadUrl={downloadUrl}
                previewHref={previewHref}
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
