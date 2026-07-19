"use client";

type TFunction = (key: string) => string;

import { useI18n } from "@/lib/i18n/use-locale";
import type { DirEntry, UploadProgress } from "./ssh-file-manager-parts";
import { formatSshFileDate, formatSshFileSize } from "./ssh-file-manager-parts";

type UploadsProps = {
  uploads: UploadProgress[];
};

export function SshUploadProgressList({ uploads }: UploadsProps) {
  if (uploads.length === 0) return null;

  return (
    <div className="space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-2">
      {uploads.map((u, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={`min-w-16 shrink-0 truncate ${u.status === "error" ? "text-[var(--danger)]" : u.status === "done" ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>
            {u.fileName}
          </span>
          {u.status === "uploading" && (
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div className="h-full bg-[var(--color-action-bg)] transition-all" style={{ width: `${u.percent}%` }} />
            </div>
          )}
          {u.status === "done" && <span className="text-[var(--success)]">✓</span>}
          {u.status === "error" && <span className="text-[var(--danger)] text-[10px]">{u.error}</span>}
        </div>
      ))}
    </div>
  );
}

type ListProps = {
  dragOver: boolean;
  entries: DirEntry[];
  error: string;
  loading: boolean;
  onDelete: (entry: DirEntry) => void;
  onDownload: (entry: DirEntry) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onNavigateInto: (dirName: string) => void;
  onGoUp?: () => void;
  onRename: () => void;
  renameTarget: string | null;
  renameValue: string;
  selectedEntry: string | null;
  setRenameTarget: (value: string | null) => void;
  setRenameValue: (value: string) => void;
  setSelectedEntry: (value: string | null) => void;
  t: TFunction;
};

export function SshFileList({
  dragOver,
  entries,
  error,
  loading,
  onDelete,
  onDownload,
  onDragLeave,
  onDragOver,
  onDrop,
  onNavigateInto,
  onGoUp,
  onRename,
  renameTarget,
  renameValue,
  selectedEntry,
  setRenameTarget,
  setRenameValue,
  setSelectedEntry,
  t,
}: ListProps) {
  const { locale } = useI18n();
  return (
    <div
      className={`flex-1 overflow-y-auto rounded-xl border p-2 transition ${
        dragOver ? "border-[var(--color-action-border)]/40 bg-[var(--color-action-bg)]/5" : "border-[var(--border-subtle)] bg-[var(--surface-subtle)]"
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ minHeight: "200px" }}
    >
      {dragOver && <div className="flex h-full items-center justify-center text-sm text-[var(--color-action-fg)]">📥 {t("sshFileManager.dropHere")}</div>}
      {!dragOver && loading && <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">{t("sshFileManager.loading")}</div>}
      {!dragOver && !loading && entries.length === 0 && !error && (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center text-xs text-[var(--text-muted)]">
          <p>{t("sshFileManager.empty")}</p>
          {onGoUp ? (
            <button
              type="button"
              onClick={onGoUp}
              data-testid="ssh-files-up-level"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
              aria-label={t("sshFileManager.upLevelAria")}
            >
              <span aria-hidden="true">↑</span>
              {t("sshFileManager.upLevel")}
            </button>
          ) : null}
        </div>
      )}
      {!dragOver && !loading && entries.map((entry) => (
        <div key={entry.name} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-[var(--surface-hover)] ${selectedEntry === entry.name ? "bg-[var(--surface-elevated)]" : ""}`} onClick={() => setSelectedEntry(entry.name)} onDoubleClick={() => { if (entry.isDirectory) onNavigateInto(entry.name); else onDownload(entry); }}>
          <span className="shrink-0" aria-hidden="true">{entry.isDirectory ? "📁" : entry.isSymlink ? "🔗" : "📄"}</span>
          {renameTarget === entry.name ? (
            <RenameInlineEditor
              renameValue={renameValue}
              setRenameTarget={setRenameTarget}
              setRenameValue={setRenameValue}
              onRename={onRename}
              t={t}
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${entry.isDirectory ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>{entry.name}</span>
          )}
          {renameTarget !== entry.name && (
            <>
              <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{entry.isFile ? formatSshFileSize(entry.size) : ""}</span>
              <span className="hidden shrink-0 text-[10px] text-[var(--text-muted)] lg:block">{formatSshFileDate(entry.modifyTime, locale)}</span>
              {entry.isFile && <button onClick={(e) => { e.stopPropagation(); onDownload(entry); }} className="min-h-11 min-w-11 shrink-0 text-[var(--text-muted)] opacity-100 transition hover:text-[var(--color-action)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={t("sshFileManager.download")} title={t("sshFileManager.download")}>⬇</button>}
              <button onClick={(e) => { e.stopPropagation(); setRenameTarget(entry.name); setRenameValue(entry.name); }} className="min-h-11 min-w-11 shrink-0 text-[var(--text-muted)] opacity-100 transition hover:text-[var(--color-action)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={t("sshFileManager.rename")} title={t("sshFileManager.rename")}>✎</button>
              {entry.isFile && <button onClick={(e) => { e.stopPropagation(); onDelete(entry); }} className="min-h-11 min-w-11 shrink-0 text-[var(--text-muted)] opacity-100 transition hover:text-[var(--danger)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={t("sshFileManager.delete")} title={t("sshFileManager.delete")}>🗑</button>}
            </>
          )}
        </div>
      ))}
      {!dragOver && !loading && entries.length > 0 && <div className="mt-2 border-t border-[var(--border-subtle)] pt-1 text-center text-[10px] text-[var(--text-muted)]">{t("sshFileManager.dragHint")}</div>}
    </div>
  );
}

type RenameInlineEditorProps = Pick<ListProps, "onRename" | "setRenameTarget" | "setRenameValue" | "t"> & {
  renameValue: string;
};

function RenameInlineEditor({ onRename, renameValue, setRenameTarget, setRenameValue, t }: RenameInlineEditorProps) {
  return (
    <div className="flex flex-1 items-center gap-1">
      <input value={renameValue} aria-label={t("sshFileManager.rename")} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onRename(); if (e.key === "Escape") { setRenameTarget(null); setRenameValue(""); } }} className="min-h-7 min-w-0 flex-1 rounded border border-[var(--color-action-border)]/30 bg-[var(--surface-hover)] px-2 text-xs text-[var(--text-primary)] outline-none" autoFocus onClick={(e) => e.stopPropagation()} />
      <button onClick={(e) => { e.stopPropagation(); onRename(); }} aria-label={t("common.confirm")} className="text-[var(--color-action)] hover:text-[var(--color-action-fg)]">✓</button>
      <button onClick={(e) => { e.stopPropagation(); setRenameTarget(null); setRenameValue(""); }} aria-label={t("common.cancel")} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">✕</button>
    </div>
  );
}
