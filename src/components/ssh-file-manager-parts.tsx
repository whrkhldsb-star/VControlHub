"use client";

import type { RefObject } from "react";

type TFunction = (key: string) => string;

export type DirEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
};

export type UploadProgress = {
  fileName: string;
  percent: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

export function formatSshFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatSshFileDate(unix: number): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

type HeaderProps = {
  breadcrumbs: string[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  mkdirName: string;
  onMkdir: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
  onSelectFiles: (files: FileList) => void;
  setMkdirName: (name: string) => void;
  setShowMkdir: (show: boolean) => void;
  showMkdir: boolean;
  t: TFunction;
};

export function SshFileManagerHeader({
  breadcrumbs,
  fileInputRef,
  mkdirName,
  onMkdir,
  onNavigateToBreadcrumb,
  onSelectFiles,
  setMkdirName,
  setShowMkdir,
  showMkdir,
  t,
}: HeaderProps) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--text-primary)] light:text-[var(--text-disabled)]" aria-hidden="true">📁</span>
        <span className="text-sm font-medium text-[var(--text-primary)] light:text-[var(--text-disabled)]">{t("sshFileManager.title")}</span>
        <button type="button" onClick={() => setShowMkdir(!showMkdir)} className="ml-auto min-h-9 rounded-full border border-[var(--border-subtle)] light:border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)] light:text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50" aria-label={t("sshFileManager.newFolder")} title={t("sshFileManager.newFolder")}>
          📂+
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="min-h-9 rounded-full border border-[var(--color-action-border)]/20 px-2 py-0.5 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20">
          {t("sshFileManager.upload")}
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onSelectFiles(e.target.files);
            e.target.value = "";
          }
        }} />
      </div>

      <div className="flex flex-wrap items-center gap-0.5 text-xs">
        <button type="button" onClick={() => onNavigateToBreadcrumb(-1)} className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]">/</button>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <button type="button" onClick={() => onNavigateToBreadcrumb(i)} className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]">{crumb}</button>
            {i < breadcrumbs.length - 1 && <span className="text-[var(--text-muted)]">/</span>}
          </span>
        ))}
      </div>

      {showMkdir && (
        <div className="mt-2 flex gap-1.5">
          <input value={mkdirName} aria-label={t("sshFileManager.folderName")} onChange={(e) => setMkdirName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onMkdir()} placeholder={t("sshFileManager.folderName")} className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/30" autoFocus />
          <button onClick={onMkdir} aria-label={t("common.confirm")} data-tone="cyan" className="min-h-9 min-w-9 shrink-0 rounded-lg border border-[var(--color-action-border)]/20 px-2 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20">✓</button>
          <button onClick={() => { setShowMkdir(false); setMkdirName(""); }} aria-label={t("common.cancel")} className="min-h-9 min-w-9 shrink-0 rounded-lg border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]">✕</button>
        </div>
      )}
    </div>
  );
}
