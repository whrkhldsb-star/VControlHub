"use client";

/**
 * TR-042: 系统配置导出/导入 UI
 *
 * 嵌入设置页 advanced tab 下方。支持：
 * - 一键导出 .vch.json 配置快照（脱敏）
 * - 上传配置文件 → 预览导入（dryRun）→ 确认导入
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

  // ── 导出 ──────────────────────────────────────────────

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await csrfFetch("/api/system/export", { method: "GET" });
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

  // ── 文件选择 ──────────────────────────────────────────

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
        setFileError(t("systemConfig.import.invalidFile"));
        setSelectedFile(null);
      }
    };
    reader.onerror = () => setFileError(t("systemConfig.import.invalidFile"));
    reader.readAsText(file);
  }

  // ── 预览导入 ──────────────────────────────────────────

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
      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setPreview(data.preview as ImportPreview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("systemConfig.import.result.error"));
    } finally {
      setPreviewing(false);
    }
  }

  // ── 执行导入 ──────────────────────────────────────────

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

  // ── 渲染 ──────────────────────────────────────────────

  return (
    <div className="space-y-4 border border-[var(--border)] rounded-lg p-4 bg-[var(--bg-primary)]">
      {/* 标题 */}
      <div>
        <span className="text-xs text-[var(--text-secondary)]">{t("systemConfig.eyebrow")}</span>
        <h3 className="text-lg font-semibold mt-0.5">{t("systemConfig.title")}</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{t("systemConfig.description")}</p>
      </div>

      {/* 导出区 */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("systemConfig.export.title")}</h4>
        <p className="text-xs text-[var(--text-secondary)]">{t("systemConfig.export.hint")}</p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition"
        >
          {exporting ? t("systemConfig.export.exporting") : t("systemConfig.export.button")}
        </button>
        {exportError && (
          <p className="text-sm text-red-500">{exportError}</p>
        )}
      </div>

      {/* 分割线 */}
      <hr className="border-[var(--border)]" />

      {/* 导入区 */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">{t("systemConfig.import.title")}</h4>

        {/* 文件选择 */}
        <div className="space-y-1">
          <label className="text-sm text-[var(--text-secondary)]">
            {t("systemConfig.import.fileLabel")}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="block w-full text-sm text-[var(--text-secondary)]
              file:mr-3 file:py-1.5 file:px-4 file:rounded-md
              file:border-0 file:bg-[var(--accent)] file:text-white
              hover:file:opacity-90 cursor-pointer"
          />
          {selectedFileName && (
            <p className="text-xs text-[var(--text-secondary)]">{selectedFileName}</p>
          )}
          {fileError && (
            <p className="text-sm text-red-500">{fileError}</p>
          )}
        </div>

        {/* 选项 */}
        {selectedFile && !fileError && (
          <div className="space-y-2 p-3 rounded-md bg-[var(--bg-secondary)]">
            <span className="text-sm font-medium">{t("systemConfig.import.options")}</span>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              {t("systemConfig.import.overwrite")}
              <span className="text-xs text-[var(--text-secondary)]">{t("systemConfig.import.overwriteHint")}</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={importUsers} onChange={(e) => setImportUsers(e.target.checked)} />
              {t("systemConfig.import.importUsers")}
              <span className="text-xs text-[var(--text-secondary)]">{t("systemConfig.import.importUsersHint")}</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={importSettings} onChange={(e) => setImportSettings(e.target.checked)} />
              {t("systemConfig.import.importSettings")}
              <span className="text-xs text-[var(--text-secondary)]">{t("systemConfig.import.importSettingsHint")}</span>
            </label>

            {/* 预览按钮 */}
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="px-4 py-2 text-sm rounded-md border border-[var(--border)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 transition"
            >
              {previewing ? t("systemConfig.import.previewing") : t("systemConfig.import.previewButton")}
            </button>
          </div>
        )}

        {/* 预览结果 */}
        {preview && (
          <div className="space-y-2 p-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]">
            <h5 className="text-sm font-medium">{t("systemConfig.import.preview.title")}</h5>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("systemConfig.import.preview.totalRecords").replace("{count}", String(preview.totalRecords))}
            </p>

            {/* 表格 → list 形式 */}
            <div className="space-y-1">
              {Object.entries(preview.summary).map(([table, counts]) => (
                <div key={table} className="flex justify-between text-xs">
                  <span>{table}</span>
                  <span className="text-[var(--text-secondary)]">
                    +{counts.create} ↻{counts.update} ⊘{counts.skip}
                  </span>
                </div>
              ))}
            </div>

            {/* 警告 */}
            {preview.warnings.length > 0 && (
              <div className="space-y-1 mt-2">
                <span className="text-xs font-medium text-yellow-500">
                  {t("systemConfig.import.preview.warnings")}
                </span>
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-500">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* 确认导入按钮 */}
            <button
              onClick={handleExecute}
              disabled={executing || preview.totalRecords === 0}
              className="px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition mt-2"
            >
              {executing ? t("systemConfig.import.executing") : t("systemConfig.import.executeButton")}
            </button>
          </div>
        )}

        {/* 导入结果 */}
        {result && (
          <div className="p-3 rounded-md bg-green-500/10 border border-green-500/30">
            <p className="text-sm text-green-500">
              {t("systemConfig.import.result.success")
                .replace("{created}", String(result.created))
                .replace("{updated}", String(result.updated))
                .replace("{skipped}", String(result.skipped))}
            </p>
          </div>
        )}

        {importError && (
          <p className="text-sm text-red-500">{importError}</p>
        )}
      </div>
    </div>
  );
}