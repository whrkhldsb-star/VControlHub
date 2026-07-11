"use client";

/**
 * TR-042: System config export/import UI
 *
 * Embedded under the settings advanced tab. Supports:
 * - One-click .vch.json config snapshot export (sanitized)
 * - Upload config file → preview import (dryRun) → confirm import
 */

import { useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EXPORT_SCHEMA_VERSION, type ExportFile, type ImportPreview } from "@/lib/system/config-schema";

export function SystemConfigSection() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<ExportFile | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const [overwrite, setOverwrite] = useState(true);
  const [importUsers, setImportUsers] = useState(true);
  const [importSettings, setImportSettings] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [exportMode, setExportMode] = useState<"standard" | "full">("standard");

  // ── Export ──────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await csrfFetch(`/api/system/export?mode=${exportMode}`, { method: "GET" });
      if (!res.ok) throw new Error(t("systemConfig.export.error"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vch-config-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t("systemConfig.export.error"));
    } finally {
      setExporting(false);
    }
  }

  // ── File selection ───────────────────────────────────────

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setFileError(null);
    setPreview(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        if (json.schemaVersion !== EXPORT_SCHEMA_VERSION) {
          setFileError(t("systemConfig.import.schemaVersionMismatch")
            .replace("{fileVersion}", String(json.schemaVersion ?? "?"))
            .replace("{currentVersion}", String(EXPORT_SCHEMA_VERSION)));
          return;
        }
        setSelectedFile(json as ExportFile);
      } catch {
        // File content is not valid JSON or schema mismatch — show an error to the user.
        setFileError(t("systemConfig.import.invalidFile"));
        setSelectedFile(null);
      }
    };
    reader.onerror = () => setFileError(t("systemConfig.import.invalidFile"));
    reader.readAsText(file);
  }

  // ── Import preview ───────────────────────────────────────

  async function handlePreview() {
    if (!selectedFile) return;
    setPreviewing(true);
    setPreview(null);
    setImportError(null);
    try {
      const res = await csrfFetch("/api/system/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: selectedFile,
          dryRun: true,
          overwriteExisting: overwrite,
          importUsers,
          importSettings,
        }),
      });
      if (!res.ok) throw new Error(t("systemConfig.import.previewFailed"));
      const data = await res.json();
      setPreview(data.preview as ImportPreview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("systemConfig.import.result.error"));
    } finally {
      setPreviewing(false);
    }
  }

  // ── Execute import ───────────────────────────────────────

  async function handleExecute() {
    if (!selectedFile) return;
    setExecuting(true);
    setResult(null);
    setImportError(null);
    try {
      const res = await csrfFetch("/api/system/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: selectedFile,
          dryRun: false,
          overwriteExisting: overwrite,
          importUsers,
          importSettings,
        }),
      });
      const data = await res.json();
      if (data.result) {
        setResult(data.result);
      } else {
        setImportError(data.error || t("systemConfig.import.result.error"));
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("systemConfig.import.result.error"));
    } finally {
      setExecuting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)] p-4 bg-[var(--surface)]">
      {/* Title */}
      <div>
        <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.eyebrow")}</span>
        <h3 className="text-lg font-semibold mt-0.5 text-[var(--text-primary)]">{t("systemConfig.title")}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{t("systemConfig.description")}</p>
      </div>

      {/* Export area */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">{t("systemConfig.export.title")}</h4>
        <p className="text-xs text-[var(--text-secondary)]">{t("systemConfig.export.hint")}</p>

        {/* Export mode selection */}
        <div className="flex flex-col gap-2 py-1">
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="exportMode"
              value="standard"
              checked={exportMode === "standard"}
              onChange={() => setExportMode("standard")}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <div className="flex flex-col">
              <span className="text-[var(--text-primary)] font-medium">{t("systemConfig.export.modeStandard")}</span>
              <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.export.modeStandardHint")}</span>
            </div>
          </label>
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="exportMode"
              value="full"
              checked={exportMode === "full"}
              onChange={() => setExportMode("full")}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <div className="flex flex-col">
              <span className="text-[var(--text-primary)] font-medium">{t("systemConfig.export.modeFull")}</span>
              <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.export.modeFullHint")}</span>
            </div>
          </label>
        </div>

        {exportMode === "full" && (
          <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning)]/[0.08] px-3.5 py-2.5 text-xs text-[var(--warning)] light:text-[var(--warning)]">
            ⚠ {t("systemConfig.export.fullWarning")}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-[var(--color-action-fg)] hover:opacity-90 disabled:opacity-50 transition font-medium"
        >
          {exporting ? t("systemConfig.export.exporting") : t("systemConfig.export.button")}
        </button>
        {exportError && (
          <p className="text-sm text-[var(--danger)] light:text-[var(--danger)]">{exportError}</p>
        )}
      </div>

      {/* Divider */}
      <hr className="border-[var(--border)]" />

      {/* Import area */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">{t("systemConfig.import.title")}</h4>

        {/* File selection */}
        <div className="space-y-1">
          <label htmlFor="system-config-import-file" className="text-sm text-[var(--text-secondary)]">
            {t("systemConfig.import.fileLabel")}
          </label>
          <input
            id="system-config-import-file"
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="block w-full text-sm text-[var(--text-secondary)]
              file:mr-3 file:py-1.5 file:px-4 file:rounded-lg
              file:border-0 file:bg-[var(--accent)] file:text-[var(--color-action-fg)]
              hover:file:opacity-90 cursor-pointer"
          />
          {selectedFileName && (
            <p className="text-xs text-[var(--text-secondary)]">{selectedFileName}</p>
          )}
          {fileError && (
            <p className="text-sm text-[var(--danger)] light:text-[var(--danger)]">{fileError}</p>
          )}
        </div>

        {/* Options */}
        {selectedFile && !fileError && (
          <div className="space-y-2 p-3 rounded-lg bg-[var(--surface-elevated)]">
            <span className="text-sm font-medium text-[var(--text-primary)]">{t("systemConfig.import.options")}</span>

            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-[var(--accent)]" />
              {t("systemConfig.import.overwrite")}
              <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.import.overwriteHint")}</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={importUsers} onChange={(e) => setImportUsers(e.target.checked)} className="accent-[var(--accent)]" />
              {t("systemConfig.import.importUsers")}
              <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.import.importUsersHint")}</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" checked={importSettings} onChange={(e) => setImportSettings(e.target.checked)} className="accent-[var(--accent)]" />
              {t("systemConfig.import.importSettings")}
              <span className="text-xs text-[var(--text-muted)]">{t("systemConfig.import.importSettingsHint")}</span>
            </label>

            {/* Preview button */}
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 transition"
            >
              {previewing ? t("systemConfig.import.previewing") : t("systemConfig.import.previewButton")}
            </button>
          </div>
        )}

        {/* Preview result */}
        {preview && (
          <div className="space-y-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
            <h5 className="text-sm font-medium text-[var(--text-primary)]">{t("systemConfig.import.preview.title")}</h5>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("systemConfig.import.preview.totalRecords").replace("{count}", String(preview.totalRecords))}
            </p>

            {/* Table as a compact list */}
            <div className="space-y-1">
              {Object.entries(preview.summary).map(([table, counts]) => (
                <div key={table} className="flex justify-between text-xs text-[var(--text-primary)]">
                  <span>{table}</span>
                  <span className="text-[var(--text-secondary)]">
                    +{counts.create} ↻{counts.update} ⊘{counts.skip}
                  </span>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div className="space-y-1 mt-2">
                <span className="text-xs font-medium text-[var(--warning)] light:text-[var(--warning)]">
                  {t("systemConfig.import.preview.warnings")}
                </span>
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[var(--warning)] light:text-[var(--warning)]">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* Confirm import button */}
            <button
              onClick={handleExecute}
              disabled={executing || preview.totalRecords === 0}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-[var(--color-action-fg)] hover:opacity-90 disabled:opacity-50 transition mt-2 font-medium"
            >
              {executing ? t("systemConfig.import.executing") : t("systemConfig.import.executeButton")}
            </button>
          </div>
        )}

        {/* Import result */}
        {result && (
          <div className="p-3 rounded-lg bg-[var(--success-bg)] border border-[var(--success-border)]">
            <p className="text-sm text-[var(--success)] light:text-[var(--success)]">
              {t("systemConfig.import.result.success")
                .replace("{created}", String(result.created))
                .replace("{updated}", String(result.updated))
                .replace("{skipped}", String(result.skipped))}
            </p>
          </div>
        )}

        {importError && (
          <p className="text-sm text-[var(--danger)] light:text-[var(--danger)]">{importError}</p>
        )}
      </div>
    </div>
  );
}
