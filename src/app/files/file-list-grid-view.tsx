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
            className="mx-auto mb-3 text-slate-600"
          >
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <p className="text-sm text-slate-400">{emptyMessage}</p>
        </div>
      ) : null}

      {/* Folder cards */}
      {sortedFolders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          onClick={() => navigateToFolder(folder.path)}
          data-testid="folder-card"
          className="group flex min-h-[156px] flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-slate-900/80 p-5 text-center transition-colors duration-150 hover:border-amber-400/30 hover:bg-amber-400/[0.04]"
        >
          <div
            className="rounded-xl bg-amber-400/10 p-3 transition-colors group-hover:bg-amber-400/20"
            aria-hidden="true"
          >
            <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={36} />
          </div>
          <span className="w-full truncate text-sm font-medium text-cyan-100 group-hover:text-white light:hover:text-slate-900 transition">
            {folder.displayName ?? folder.name}
          </span>
          <span className="text-xs text-slate-500">
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
            className={`group relative flex flex-col rounded-2xl border border-white/[0.06] bg-slate-900/80 text-center transition-colors duration-200 hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-400/5 overflow-hidden ${isChecked ? "ring-2 ring-cyan-400/50 bg-cyan-400/[0.04] light:bg-cyan-50" : ""}`}
          >
            {/* Selection checkbox */}
            <div className="absolute top-2 left-2 z-20">
              {entryCanWrite(entry) || entryCanDelete(entry) ? (
                <input
                  type="checkbox"
                  checked={effectiveSelectedIdSet.has(entry.id)}
                  onChange={() => toggleOne(entry.id)}
                  aria-label={`选择 ${entry.name}`}
                  className="h-4 w-4 rounded-lg border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                />
              ) : null}
            </div>

            {/* Thumbnail / icon area */}
            <div className="relative flex items-center justify-center pt-6 pb-2 px-4">
              {thumbUrl ? (
                <div
                  data-testid="file-thumbnail-overlay"
                  className="w-full h-28 rounded-xl overflow-hidden border border-white/[0.06]"
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
                <div className="rounded-xl bg-white/[0.03] p-4">
                  <FileTypeIcon entry={entry} size={44} />
                </div>
              )}
            </div>

            {/* File name & meta */}
            <div className="px-4 pb-2 flex-1 flex flex-col">
              {entry.previewable && entryCanRead(entry) ? (
                <Link
                  href={previewHref}
                  className="w-full truncate text-sm font-medium text-white hover:text-cyan-100 transition"
                >
                  {entry.name}
                </Link>
              ) : (
                <span className="w-full truncate text-sm font-medium text-white">
                  {entry.name}
                </span>
              )}
              <div className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-500">
                <span>{entry.sizeLabel}</span>
                <span className="text-slate-700">·</span>
                <span className="truncate">{entry.storageNode.name}</span>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-white/[0.04] bg-slate-950/40">
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
