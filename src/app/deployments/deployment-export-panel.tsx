"use client";

import { useEffect, useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type DeploymentExportManifest = {
  appName?: string;
  domain?: string;
  generatedAt?: string;
  dangerousEnvFlags?: string[];
};

type DeploymentExportFileMap = Record<string, string>;

type DeploymentExportResponse = {
  export?: {
    id?: string;
    name?: string;
    manifest?: DeploymentExportManifest;
    files?: DeploymentExportFileMap;
  };
};

const EMPTY_EXPORT_FILES: DeploymentExportFileMap = {};

type TreeNode = {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: TreeNode[];
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAppName(value: string) {
  return value.trim().toLowerCase();
}

function buildFileTree(files: DeploymentExportFileMap): TreeNode[] {
  const root: TreeNode = { name: "", fullPath: "", isFile: false, children: [] };
  const sorted = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  for (const [rawName] of sorted) {
    const segments = rawName.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let cursor = root;
    let running = "";
    segments.forEach((segment, index) => {
      running = running ? `${running}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let next = cursor.children.find((child) => child.name === segment);
      if (!next) {
        next = { name: segment, fullPath: running, isFile, children: [] };
        cursor.children.push(next);
      } else if (isFile) {
        next.isFile = true;
      }
      cursor = next;
    });
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1; // directories first
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    // execCommand not supported or blocked — clipboard copy fails gracefully.
    ok = false;
  }
  textarea.remove();
  return ok;
}

function downloadTextFile(filename: string, content: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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

  // Reset the active file whenever the export result changes; default to the
  // first file (alphabetical) so the preview panel never opens empty.
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

  // Auto-clear the per-file "copied" indicator after a short delay.
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
        method: "POST",
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
      const response = await fetch(`/api/deploy-export/${encodeURIComponent(result.id)}/zip`, {
        method: "GET",
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || t("deploymentsPage.export.downloadHttpError").replace("{status}", String(response.status)));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      link.download = match?.[1] || `${result.name || "deployment-export"}.zip`;
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
 <section data-card className="mb-6 ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70">Portable Export</p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{t("deploymentsPage.export.title")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("deploymentsPage.export.desc")}
          </p>
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
            className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          {t("deploymentsPage.export.appName")}
          <input
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            placeholder="vcontrolhub"
            className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </label>
        <button
          disabled={pending}
          className="rounded-lg bg-[var(--color-action-bg)] px-4 py-2 text-sm font-semibold text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)] disabled:cursor-not-allowed disabled:opacity-60"
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
        <div data-tone="cyan" className="mt-4 rounded-xl border border-[var(--color-action-border)]/20 p-4 light:bg-[var(--color-action-bg)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{result.name ?? "portable deployment"}</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("deploymentsPage.export.summary").replace("{domain}", result.manifest?.domain ?? "example.com").replace("{count}", String(fileCount)).replace("{size}", (totalSize / 1024).toFixed(1))}
              </p>
            </div>
            <button
              type="button"
              onClick={handleZipDownload}
              disabled={zipPending || !result.id}
              data-testid="deploy-export-zip"
              className="rounded-lg border border-[var(--color-action-border)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/10 disabled:cursor-not-allowed disabled:opacity-60"
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
            <DeploymentExportTree
              tree={tree}
              activePath={activePath}
              onSelect={setActivePath}
            />
            <DeploymentFilePreview
              fileNames={fileNames}
              activePath={activePath}
              content={activePath ? files[activePath] ?? "" : ""}
              onCopy={handleCopy}
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

type TreeProps = {
  tree: TreeNode[];
  activePath: string | null;
  onSelect: (path: string) => void;
};

function nodeKey(node: TreeNode) {
  return node.fullPath || node.name;
}

function DeploymentExportTree({ tree, activePath, onSelect }: TreeProps) {
  const { t } = useI18n();
  return (
    <div
      data-testid="deploy-export-tree"
      className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-3 font-mono text-xs text-[var(--text-secondary)]"
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70">{t("deploymentsPage.export.fileTree")}</p>
      {tree.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{t("deploymentsPage.export.noFiles")}</p>
      ) : (
        <ul className="space-y-1">
          {tree.map((node) => (
            <TreeRow
              key={nodeKey(node)}
              node={node}
              depth={0}
              activePath={activePath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const { t } = useI18n();
  if (!node.isFile) {
    return (
      <li>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
          <span aria-hidden>📁</span>
          <span className="font-semibold text-[var(--text-secondary)]">{node.name || "/"}</span>
        </div>
        {node.children.length > 0 && (
          <ul className="mt-1 space-y-1">
            {node.children.map((child) => (
              <TreeRow
                key={nodeKey(child)}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const isActive = activePath === node.fullPath;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.fullPath)}
        data-testid={`deploy-export-file-${node.fullPath}`}
        className={`flex w-full items-center gap-1 rounded-lg px-1 py-0.5 text-left transition ${
          isActive
            ? "bg-[var(--color-action-bg)]/20 text-[var(--text-primary)]"
            : "hover:bg-[var(--surface)]/[0.04] text-[var(--text-secondary)]"
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        <span aria-hidden>📄</span>
        <span className="truncate">{node.name}</span>
        {isActive ? <span className="ml-auto text-[10px] text-[var(--text-secondary)]">{t("deploymentsPage.export.viewing")}</span> : null}
      </button>
    </li>
  );
}

type PreviewProps = {
  fileNames: string[];
  activePath: string | null;
  content: string;
  onCopy: (content: string, path: string) => void;
  onDownload: (path: string, content: string) => void;
  onSelect: (path: string) => void;
  copyState: { path: string; at: number } | null;
};

function DeploymentFilePreview({
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
        <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]/70">
          {t("deploymentsPage.export.rollbackFile")}
        </label>
        <select
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
          className="rounded-lg border border-[var(--color-action-border)]/40 px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/10"
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
