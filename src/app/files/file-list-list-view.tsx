"use client";

/**
 * List view — dense spreadsheet-style table on desktop with a mobile
 * card fallback below the `md` breakpoint.
 *
 * Extracted from file-list-client.tsx in R31. This is the default view
 * (largest of the three). The desktop side renders a 7-column grid
 * with sticky checkbox + sortable headers; the mobile side stacks the
 * same data into compact cards so action buttons stay reachable.
 */
import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileTypeIcon } from "./file-entry-icons";
import { FileRowActions, FolderDownloadActionLink } from "./file-list-actions";
import { RenameInlineForm, MoveInlineForm } from "./file-row-actions";
import { SortIcon } from "./use-file-list-sort";
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
type SortDir = "asc" | "desc";
type SortKey = "name" | "size" | "source" | "updated";

export type FileListListViewProps = {
  sortedFolders: FolderProp[];
  sortedFiles: FileProp[];
  visibleFilesCount: number;
  emptyMessage: string;
  allSelected: boolean;
  someSelected: boolean;
  effectiveSelectedIdSet: Set<string>;
  toggleAll: () => void;
  toggleOne: (id: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
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

export function FileListListView(props: FileListListViewProps) {
  const { t } = useI18n();
  const {
    sortedFolders,
    sortedFiles,
    visibleFilesCount,
    emptyMessage,
    allSelected,
    someSelected,
    effectiveSelectedIdSet,
    toggleAll,
    toggleOne,
    sortKey,
    sortDir,
    toggleSort,
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
    <>
      {/* Desktop table view (md+) */}
      <div className="hidden overflow-x-auto md:block" data-testid="file-table-scroll">
        <div className="min-w-[1180px]" data-testid="file-table-inner">
          <div className="grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 bg-white/5 px-5 py-3 text-xs uppercase tracking-[0.15em] text-slate-400 font-medium">
            <div>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                disabled={visibleFilesCount === 0}
                aria-label={t("fileListClient.selectAllFiles")}
                className="rounded-lg h-4 w-4 accent-cyan-400"
              />
            </div>
            <div />
            <div>
              {t("fileListClient.name")}{" "}
              <SortIcon
                col="name"
                label={t("fileListClient.name")}
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
            </div>
            <div>
              {t("fileListClient.size")}{" "}
              <SortIcon
                col="size"
                label={t("fileListClient.size")}
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
            </div>
            <div>
              {t("fileListClient.source")}{" "}
              <SortIcon
                col="source"
                label={t("fileListClient.source")}
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
            </div>
            <div>
              {t("fileListClient.modified")}{" "}
              <SortIcon
                col="updated"
                label={t("fileListClient.modified")}
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
            </div>
            <div>操作</div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-slate-400">
                {emptyMessage}
              </div>
            ) : null}

            {sortedFolders.map((folder) => (
              <div
                key={folder.path}
                className="grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.02] transition"
              >
                <div>
                  <input
                    type="checkbox"
                    disabled
                    aria-label={t("fileListClient.selectFolderDisabled")}
                    className="rounded-lg h-4 w-4 accent-cyan-400 opacity-30"
                  />
                </div>
                <div className="flex justify-center">
                  <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={22} />
                </div>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => navigateToFolder(folder.path)}
                    className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left"
                  >
                    {folder.displayName ?? folder.name}
                  </button>
                </div>
                <div className="text-slate-500">
                  {folder.fileCount + folder.folderCount} 项
                </div>
                <div className="truncate text-xs text-slate-400">
                  {folder.sourceValues[0] ?? "—"}
                </div>
                <div className="text-xs text-slate-500">—</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => navigateToFolder(folder.path)}
                    data-tone="cyan"
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 text-cyan-200 hover:bg-cyan-500/20 transition"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
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
                    compact
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

            {sortedFiles.map((fileProp) => {
              const entry: StorageEntry = toStorageEntry(fileProp);
              const downloadUrl = buildForcedDownloadHref(entry);
              const previewHref = getPreviewHref(entry);
              const isChecked = effectiveSelectedIdSet.has(fileProp.id);

              return (
                <div
                  key={entry.id}
                  className={`grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.02] transition ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
                >
                  <div>
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
                  <div className="flex justify-center">
                    <FileTypeIcon entry={entry} size={22} />
                  </div>
                  <div className="min-w-0">
                    {entry.previewable && entryCanRead(entry) ? (
                      <Link
                        href={previewHref}
                        className="truncate font-medium text-white hover:text-cyan-100 transition"
                      >
                        {entry.name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-white">
                        {entry.name}
                      </span>
                    )}
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {entry.relativePath}
                    </p>
                  </div>
                  <div className="text-slate-300">{entry.sizeLabel}</div>
                  <div className="text-slate-400 truncate text-xs">
                    {entry.storageNode.name}
                  </div>
                  <div className="text-slate-500 text-xs">
                    {entry.updatedAt ? formatDate(entry.updatedAt) : "—"}
                  </div>
                  <div className="flex flex-wrap gap-1">
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
        </div>
      </div>

      {/* Mobile card view (below md) */}
      <div className="md:hidden divide-y divide-white/[0.04]">
        {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">
            {emptyMessage}
          </div>
        ) : null}

        {sortedFolders.map((folder) => (
          <div
            key={folder.path}
            className="px-4 py-3 hover:bg-white/[0.02] transition"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-400/10 p-1.5">
                <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigateToFolder(folder.path)}
                  className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left text-sm"
                >
                  {folder.displayName ?? folder.name}
                </button>
                <div className="mt-0.5 text-xs text-slate-500">
                  {folder.fileCount + folder.folderCount} 项
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateToFolder(folder.path)}
                data-tone="cyan"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 text-cyan-200 hover:bg-cyan-500/20 transition"
              >
                打开
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
              className={`px-4 py-3 ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
            >
              <div className="flex items-start gap-3">
                {entryCanWrite(entry) || entryCanDelete(entry) ? (
                  <input
                    type="checkbox"
                    checked={effectiveSelectedIdSet.has(entry.id)}
                    onChange={() => toggleOne(entry.id)}
                    aria-label={`选择 ${entry.name}`}
                    className="mt-2 h-4 w-4 rounded-lg border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                  />
                ) : null}
                <div className="shrink-0 mt-0.5 rounded-lg bg-white/[0.03] p-1">
                  <FileTypeIcon entry={entry} size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  {entry.previewable && entryCanRead(entry) ? (
                    <Link
                      href={previewHref}
                      className="truncate font-medium text-white text-sm hover:text-cyan-100 transition"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-white text-sm">
                      {entry.name}
                    </span>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{entry.sizeLabel}</span>
                    <span>{entry.storageNode.name}</span>
                    {entry.updatedAt ? (
                      <span>{formatDate(entry.updatedAt)}</span>
                    ) : null}
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
    </>
  );
}
