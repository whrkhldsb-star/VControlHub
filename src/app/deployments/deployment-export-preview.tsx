"use client";

import { useI18n } from "@/lib/i18n/use-locale";

type PreviewProps = {
  fileNames: string[];
  activePath: string | null;
  content: string;
  onCopy: (content: string, path: string) => void;
  onDownload: (path: string, content: string) => void;
  onSelect: (path: string) => void;
  copyState: { path: string; at: number } | null;
};

export function DeploymentFilePreview({
  fileNames,
  activePath,
  content,
  onCopy,
  onDownload,
  onSelect,
  copyState,
}: PreviewProps) {
  const { t } = useI18n();
  if (fileNames.length === 0 || !activePath) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-3 text-xs text-[var(--text-muted)]">
        {t("deploymentsPage.export.emptyExport")}
      </div>
    );
  }
  const justCopied = copyState?.path === activePath;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="deploy-export-file-select"
          className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70"
        >
          {t("deploymentsPage.export.rollbackFile")}
        </label>
        <select
          id="deploy-export-file-select"
          data-testid="deploy-export-file-select"
          value={activePath}
          onChange={(event) => onSelect(event.target.value)}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--text-primary)]"
        >
          {fileNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="deploy-export-rollback"
          onClick={() => onCopy(content, activePath)}
          data-action-button data-variant="outline" className="!px-2 !py-1 !text-xs"
        >
          {justCopied ? t("deploymentsPage.export.copied") : t("deploymentsPage.export.copyRollback")}
        </button>
        <button
          type="button"
          data-testid="deploy-export-download-active"
          onClick={() => onDownload(activePath, content)}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--color-action-border)]/40"
        >
          {t("deploymentsPage.export.downloadFile")}
        </button>
      </div>
      <pre
        data-testid="deploy-export-preview"
        className="max-h-72 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]/70 p-3 text-xs text-[var(--text-secondary)]"
      >
        <code>{content}</code>
      </pre>
    </div>
  );
}
