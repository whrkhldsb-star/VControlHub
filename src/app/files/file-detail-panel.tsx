"use client";

/**
 * FileDetailPanel — the right-side slide-over panel that surfaces
 * preview / download / share / media / rename / move / delete actions
 * for a single entry.
 *
 * Extracted from `file-list-client.tsx` (TR-036 T36b) so the parent
 * chunk does not pull in the `ShareFileButton` / `RenameInlineForm` /
 * `MoveInlineForm` / `DeleteConfirmButton` import graph (and their
 * sub-imports) until the user actually opens the panel. The wrapping
 * `FileDetailPanelLazy` uses `next/dynamic` to defer the chunk.
 */
import Link from "next/link";

import {
  DeleteConfirmButton,
  RenameInlineForm,
  MoveInlineForm,
  ShareFileButton,
} from "./file-row-actions";
import {
  buildForcedDownloadHref,
  buildMediaLibraryHref,
  formatDate,
  getPreviewHref,
  type StorageEntry,
} from "./file-entry-utils";

export type FileDetailPanelProps = {
  detailEntry: StorageEntry;
  onClose: () => void;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: (type: "success" | "error" | "info", message: string) => void;
  // read/write/delete capability checks. The parent supplies these so
  // this chunk doesn't have to re-import the model layer (which would
  // defeat the lazy-load goal).
  entryCanRead: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanWrite: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
  entryCanDelete: (entry: { capabilities?: StorageEntry["capabilities"] }) => boolean;
};

export function FileDetailPanel({
  detailEntry,
  onClose,
  canShare,
  canDelete,
  onRefresh,
  onNotify,
  entryCanRead,
  entryCanWrite,
  entryCanDelete,
}: FileDetailPanelProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-detail-panel-title"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-300">
              资料详情
            </p>
            <h2
              id="file-detail-panel-title"
              className="mt-1 truncate text-lg font-semibold"
            >
              {detailEntry.name}
            </h2>
            <p className="mt-1 truncate text-xs text-slate-500">
              {detailEntry.relativePath}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500">存储节点</p>
                <p className="mt-1 font-medium">
                  {detailEntry.storageNode.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">驱动</p>
                <p className="mt-1 font-medium">
                  {detailEntry.storageNode.driver}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">大小</p>
                <p className="mt-1 font-medium">{detailEntry.sizeLabel}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">修改时间</p>
                <p className="mt-1 font-medium">
                  {detailEntry.updatedAt
                    ? formatDate(detailEntry.updatedAt)
                    : "—"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500">访问方式</p>
                <p className="mt-1 font-medium">
                  {detailEntry.directAccess.description}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              快捷操作
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detailEntry.previewable && entryCanRead(detailEntry) ? (
                <Link
                  href={getPreviewHref(detailEntry)}
                  data-tone="cyan" className="rounded-2xl border border-cyan-400/30 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20"
                >
                  预览 / 在线编辑
                </Link>
              ) : null}
              {entryCanRead(detailEntry) ? (
                <Link
                  href={buildForcedDownloadHref(detailEntry)}
                  download
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                >
                  下载文件
                </Link>
              ) : null}
              {entryCanRead(detailEntry) ? (
                <Link
                  href={buildMediaLibraryHref(detailEntry)}
                  data-tone="emerald" className="rounded-2xl border border-emerald-400/30 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20"
                >
                  在媒体库中查找
                </Link>
              ) : null}
              {canShare && entryCanRead(detailEntry) ? (
                <div data-tone="amber" className="rounded-2xl border border-amber-400/30 p-2">
                  <ShareFileButton entry={detailEntry} />
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              管理操作
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {entryCanWrite(detailEntry) ? (
                <RenameInlineForm
                  fileEntryId={detailEntry.id}
                  currentName={detailEntry.name}
                  currentPath={detailEntry.relativePath}
                  entryType={detailEntry.entryType as "FILE" | "DIRECTORY"}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
              {entryCanWrite(detailEntry) ? (
                <MoveInlineForm
                  fileEntryId={detailEntry.id}
                  name={detailEntry.name}
                  relativePath={detailEntry.relativePath}
                  storageNodeId={detailEntry.storageNode.id}
                  storageNodeName={detailEntry.storageNode.name}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
              {canDelete && entryCanDelete(detailEntry) ? (
                <DeleteConfirmButton
                  fileEntryId={detailEntry.id}
                  entryName={detailEntry.name}
                  entryType={detailEntry.entryType as "FILE" | "DIRECTORY"}
                  onRefresh={onRefresh}
                  onNotify={onNotify}
                />
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
