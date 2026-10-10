"use client";

import type { RefObject } from "react";
import { getCsrfTokenFromCookie } from "@/lib/auth/csrf-client";
import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";
import { cn } from "@/lib/ui/cn";
import { ActionButton } from "@/components/action-button";
import { Folder, FolderOpen, X } from "@/components/icons";

type TFunction = (key: string, vars?: Record<string, string | number>) => string;

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
  status:"uploading" |"done" |"error";
  error?: string;
};

export function formatSshFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatSshFileDate(unix: number, locale?: string): string {
  if (!unix) return"";
  return new Date(unix * 1000).toLocaleDateString(locale ?? undefined, {
    month:"short",
    day:"numeric",
    hour:"2-digit",
    minute:"2-digit",
  });
}

export function getCsrfToken(): string {
  return getCsrfTokenFromCookie() ?? "";
}

type HeaderProps = {
  breadcrumbs: string[];
  disabled?: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  mkdirName: string;
  onMkdir: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
  onGoUp?: () => void;
  onSelectFiles: (files: FileList) => void;
  setMkdirName: (name: string) => void;
  setShowMkdir: (show: boolean) => void;
  showMkdir: boolean;
  t: TFunction;
};

export function SshFileManagerHeader({
  breadcrumbs,
  disabled = false,
  fileInputRef,
  mkdirName,
  onMkdir,
  onNavigateToBreadcrumb,
  onGoUp,
  onSelectFiles,
  setMkdirName,
  setShowMkdir,
  showMkdir,
  t,
}: HeaderProps) {
  return (
    <div data-inset className="light:border-[var(--border)] light:bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Folder size={15} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--text-primary)]">{t("sshFileManager.title")}</span>
        <button type="button" disabled={disabled} onClick={() => setShowMkdir(!showMkdir)} className="ml-auto min-h-9 rounded-full border border-[var(--border-subtle)] light:border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-secondary)] light:text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50 disabled:cursor-not-allowed disabled:opacity-50" aria-label={t("sshFileManager.newFolder")} title={t("sshFileManager.newFolder")}>
          <FolderOpen size={15} aria-hidden="true" />
        </button>
        <ActionButton size="xs" variant="outline" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          {t("sshFileManager.upload")}
        </ActionButton>
        <input ref={fileInputRef} type="file" multiple disabled={disabled} className="hidden" onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onSelectFiles(e.target.files);
            e.target.value = "";
          }
        }} />
      </div>

      <div className="flex flex-wrap items-center gap-0.5 text-xs">
        {onGoUp ? (
          <ActionButton size="xs" variant="secondary"
            onClick={onGoUp}
            data-testid="ssh-files-header-up"
            aria-label={t("sshFileManager.upLevelAria")}
            title={t("sshFileManager.upLevel")} className="mr-1">
            ↑ {t("sshFileManager.upLevel")}
          </ActionButton>
        ) : null}
        <button type="button" onClick={() => onNavigateToBreadcrumb(-1)} className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-text)]">/</button>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-0.5">
            <button type="button" onClick={() => onNavigateToBreadcrumb(i)} className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-text)]">{crumb}</button>
            {i < breadcrumbs.length - 1 && <span className="text-[var(--text-muted)]">/</span>}
          </span>
        ))}
      </div>

      {showMkdir && (
        <div className="mt-2 flex gap-1.5">
          <input value={mkdirName} aria-label={t("sshFileManager.folderName")} onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposition(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onMkdir();
              }
            }}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder={t("sshFileManager.folderName")} className={cn(UI_INPUT,"min-h-9 min-w-0 flex-1 py-1 text-xs")} autoFocus />
          <ActionButton type="button" variant="outline" onClick={onMkdir} aria-label={t("common.confirm")} data-tone="cyan" size="sm" square className="shrink-0">✓</ActionButton>
          <ActionButton size="sm" square variant="secondary" onClick={() => { setShowMkdir(false); setMkdirName(""); }} aria-label={t("common.cancel")} className="shrink-0"><X size={16} aria-hidden /></ActionButton>
        </div>
      )}
    </div>
  );
}
