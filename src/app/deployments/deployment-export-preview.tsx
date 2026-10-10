"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";

import { Download } from "@/components/icons";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
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
      <div data-inset="" className="p-3 text-xs text-[var(--text-muted)]">
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
          className="ui-label"
        >
          {t("deploymentsPage.export.rollbackFile")}
        </label>
        <select
          id="deploy-export-file-select"
          data-testid="deploy-export-file-select"
          value={activePath}
          onChange={(event) => onSelect(event.target.value)}
          className={cn(UI_INPUT, "flex-1 text-xs")}
        >
          {fileNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <ActionButton size="sm" variant="outline"
          data-testid="deploy-export-rollback"
          onClick={() => onCopy(content, activePath)}>
          {justCopied ? t("deploymentsPage.export.copied") : t("deploymentsPage.export.copyRollback")}
        </ActionButton>
        <ActionButton
          size="xs"
          variant="secondary"
          icon={<Download aria-hidden />}
          data-testid="deploy-export-download-active"
          onClick={() => onDownload(activePath, content)}
        >
          {t("deploymentsPage.export.downloadFile")}
        </ActionButton>
      </div>
      <pre data-inset=""
        data-testid="deploy-export-preview"
        className="max-h-72 overflow-auto p-3 text-xs text-[var(--text-secondary)]"
      >
        <code>{content}</code>
      </pre>
    </div>
  );
}
