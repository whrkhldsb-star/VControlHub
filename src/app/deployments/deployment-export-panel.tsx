"use client";

import { useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import {
  EMPTY_EXPORT_FILES,
  buildFileTree,
  copyTextToClipboard,
  downloadTextFile,
  normalizeAppName,
  normalizeDomain,
  type DeploymentExportResponse,
} from "./deployment-export-helpers";
import { DeploymentExportTree } from "./deployment-export-tree";
import { DeploymentFilePreview } from "./deployment-export-preview";
import { UI_INPUT } from "@/lib/ui/classes";

export function DeploymentExportPanel() {
  const { t } = useI18n();
  const [domain, setDomain] = useState("");
  const [appName, setAppName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeploymentExportResponse["export"] | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<{ path: string; at: number } | null>(null);
  const [zipPending, setZipPending] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const files = result?.files ?? EMPTY_EXPORT_FILES;
  const tree = useMemo(() => buildFileTree(files), [files]);
  const fileNames = useMemo(() => Object.keys(files).sort((a, b) => a.localeCompare(b)), [files]);
  const fileCount = fileNames.length;
  const totalSize = useMemo(
    () => Object.values(files).reduce((acc, content) => acc + new Blob([content]).size, 0),
    [files],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- active export file is derived from the latest generated file map; syncing selection here prevents stale previews after a new export. */
  useEffect(() => {
    if (fileNames.length === 0) {
      setActivePath(null);
      return;
    }
    if (!activePath || !(activePath in files)) {
      setActivePath(fileNames[0] ?? null);
    }
  }, [fileNames, files, activePath]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(null), 1800);
    return () => clearTimeout(timer);
  }, [copyState]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setZipError(null);
    try {
      const payload = {
        domain: normalizeDomain(domain) || undefined,
        appName: normalizeAppName(appName) || undefined,
      };
      const response = (await csrfFetch("/api/deploy-export", {
        method:"POST",
        body: JSON.stringify(payload),
      })) as DeploymentExportResponse;
      setResult(response.export ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deploymentsPage.export.generateError"));
    } finally {
      setPending(false);
    }
  }

  async function handleZipDownload() {
    if (!result?.id) return;
    setZipPending(true);
    setZipError(null);
    try {
      const response = await csrfFetch<Response>(`/api/deploy-export/${encodeURIComponent(result.id)}/zip`, {
        method: "GET",
        raw: true,
      });
      if (!response.ok) {
        const text = await response.text().catch(() =>"");
        throw new Error(
          text || t("deploymentsPage.export.downloadHttpError").replace("{status}", String(response.status)),
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      link.download = match?.[1] || `${result.name ||"deployment-export"}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : t("deploymentsPage.export.downloadZipError"));
    } finally {
      setZipPending(false);
    }
  }

  async function handleCopy(content: string, fullPath: string) {
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopyState({ path: fullPath, at: Date.now() });
    }
  }

  function handleDownloadFile(fullPath: string, content: string) {
    downloadTextFile(fullPath.split("/").pop() || fullPath, content);
  }

  return (
    <section data-card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70">
            Portable Export
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
            {t("deploymentsPage.export.title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("deploymentsPage.export.desc")}</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          {t("deploymentsPage.export.targetDomain")}
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="console.example.com"
            className={UI_INPUT}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          {t("deploymentsPage.export.appName")}
          <input
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            placeholder="vcontrolhub"
            className={UI_INPUT}
          />
        </label>
        <button
          disabled={pending}
          data-action-button data-variant="primary" className="disabled:opacity-60"
        >
          {pending ? t("deploymentsPage.export.generating") : t("deploymentsPage.export.generate")}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {result && (
        <div
          data-tone="cyan"
          className="mt-4 rounded-xl border border-[var(--color-action-border)]/20 p-4 light:bg-[var(--color-action-bg)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {result.name ?? "portable deployment"}
              </h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("deploymentsPage.export.summary")
                  .replace("{domain}", result.manifest?.domain ?? "example.com")
                  .replace("{count}", String(fileCount))
                  .replace("{size}", (totalSize / 1024).toFixed(1))}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleZipDownload()}
              disabled={zipPending || !result.id}
              data-testid="deploy-export-zip"
              data-action-button data-variant="outline" className="!px-3 !py-1.5 !text-xs disabled:opacity-60"
            >
              {zipPending ? t("deploymentsPage.export.packaging") : t("deploymentsPage.export.downloadZip")}
            </button>
          </div>

          {zipError && (
            <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
              {zipError}
            </p>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <DeploymentExportTree tree={tree} activePath={activePath} onSelect={setActivePath} />
            <DeploymentFilePreview
              fileNames={fileNames}
              activePath={activePath}
              content={activePath ? files[activePath] ?? "" :""}
              onCopy={(content, path) => void handleCopy(content, path)}
              onDownload={handleDownloadFile}
              onSelect={setActivePath}
              copyState={copyState}
            />
          </div>
        </div>
      )}
    </section>
  );
}
