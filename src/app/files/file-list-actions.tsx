"use client";

/**
 * Shared per-file action buttons rendered by all three views
 * (grid / details / list) and the mobile card view.
 *
 * Extracted from file-list-client.tsx in R31. Each helper returns a
 * small ReactNode (button or anchor) and is parameterised by `compact`
 * for the icon-only variant used in dense tables.
 *
 * Permission checks live in `file-list-model` / `file-entry-utils` — we
 * only render UI here.
 */
import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileMoreActionsLazy } from "./file-more-actions-lazy";
import { DownloadIcon, PreviewIcon } from "./file-entry-icons";
import {
  buildArchiveDownloadHref,
  getPreviewActionCopy,
  type StorageEntry,
} from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";
import type { FileProp } from "./file-entry-utils";

type ToastFn = (type: "success" | "error" | "info", message: string) => void;
type EntryGuard = (entry: { capabilities?: FileProp["capabilities"] }) => boolean;

/** Compact (icon-only) toggle for action buttons rendered in dense grids. */
type CompactProp = { compact?: boolean };

/**
 * "Detail" pill that opens the right-hand file detail panel. Variants:
 * compact (square icon) vs spaced (icon + label).
 */
export function DetailActionButton({
  entry,
  onOpen,
  compact = false,
}: { entry: StorageEntry; onOpen: (id: string) => void } & CompactProp) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      title={t("fileListClient.detailTitle")}
      aria-label={`资料详情 ${entry.name}`}
      onClick={() => onOpen(entry.id)}
      className={
        compact
          ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)] transition hover:bg-[var(--accent-bg)]"
          : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-1.5 text-xs text-[var(--accent)] transition hover:bg-[var(--accent-bg)]"
      }
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      {compact ? null : <span>详情</span>}
    </button>
  );
}

/**
 * Per-file "Download" anchor. Honours `entryCanRead` (omitted when the
 * caller doesn't have read capability — protects against link bypass).
 * External URLs open in a new tab; internal hrefs use the `download`
 * attribute so the browser forces a save dialog instead of inline view.
 */
export function DownloadActionLink({
  entry,
  downloadUrl,
  entryCanRead,
  compact = false,
}: {
  entry: StorageEntry;
  downloadUrl: string;
  entryCanRead: EntryGuard;
} & CompactProp) {
  const { t } = useI18n();
  if (!entryCanRead(entry)) return null;
  return (
    <Link
      href={downloadUrl}
      title={t("fileListClient.downloadTitle")}
      aria-label={`下载 ${entry.name}`}
      download={downloadUrl.startsWith("/") ? true : undefined}
      target={downloadUrl.startsWith("/") ? undefined : "_blank"}
      rel={downloadUrl.startsWith("/") ? undefined : "noopener noreferrer"}
      className={
        compact
          ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)]"
          : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)]"
      }
    >
      <DownloadIcon />
      {compact ? null : <span>下载</span>}
    </Link>
  );
}

/**
 * "Download folder archive" anchor. Calls `buildArchiveDownloadHref`
 * which can return null when the folder is virtual (no source mount);
 * we early-return when there's no archivable backing store.
 */
export function FolderDownloadActionLink({
  folder,
  entryCanRead,
  compact = false,
}: {
  folder: FolderProp;
  entryCanRead: EntryGuard;
} & CompactProp) {
  const { t } = useI18n();
  if (!entryCanRead(folder)) return null;
  const href = buildArchiveDownloadHref({
    storageNodeId: folder.storageNodeId ?? folder.sourceKeys[0],
    relativePath: folder.relativePath ?? folder.path,
  });
  if (!href) return null;
  return (
    <Link
      href={href}
      title={t("fileListClient.downloadFolderArchiveTitle")}
      aria-label={`下载目录 ${folder.displayName ?? folder.name}`}
      download
      className={
        compact
          ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)]"
          : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 hover:text-[var(--text-primary)]"
      }
    >
      <DownloadIcon />
      {compact ? null : <span>下载</span>}
    </Link>
  );
}

/**
 * Composite "row of action buttons" for a single file row. Always
 * renders: detail button + (conditional) preview link + download link
 * + 更多 (rename/move/share/delete). Used by all three views and the
 * mobile card view, so any cross-view tweak only changes one place.
 */
export function FileRowActions({
  entry,
  downloadUrl,
  previewHref,
  compact = false,
  canShare,
  canDelete,
  onRefresh,
  onNotify,
  onOpenDetail,
  entryCanRead,
  entryCanWrite,
  entryCanDelete,
}: {
  entry: StorageEntry;
  downloadUrl: string;
  previewHref: string;
  canShare: boolean;
  canDelete: boolean;
  onRefresh?: () => void;
  onNotify: ToastFn;
  onOpenDetail: (id: string) => void;
  entryCanRead: EntryGuard;
  entryCanWrite: EntryGuard;
  entryCanDelete: EntryGuard;
} & CompactProp) {
  const previewAction = getPreviewActionCopy(entry);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <DetailActionButton entry={entry} onOpen={onOpenDetail} compact={compact} />
      {entry.previewable && entryCanRead(entry) ? (
        <Link
          href={previewHref}
          title={previewAction.title}
          aria-label={previewAction.label}
          data-tone="cyan"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-action-border)]/30 text-[var(--text-primary)] transition hover:bg-[var(--color-action)]/20"
        >
          <PreviewIcon />
        </Link>
      ) : null}
      <DownloadActionLink
        entry={entry}
        downloadUrl={downloadUrl}
        entryCanRead={entryCanRead}
        compact
      />
      <FileMoreActionsLazy
        entry={entry}
        compact={compact}
        canShare={canShare}
        canDelete={canDelete}
        onRefresh={onRefresh}
        onNotify={onNotify}
        entryCanRead={entryCanRead}
        entryCanWrite={entryCanWrite}
        entryCanDelete={entryCanDelete}
      />
    </div>
  );
}
