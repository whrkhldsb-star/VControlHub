"use client";

/**
 * SshFileManager — remote file browser with drag-and-drop upload.
 *
 * Rendered as a side panel inside SshTerminalPanel when the user
 * toggles the "Files" button. Browses the remote server via SFTP
 * API routes, supports navigation, upload, download, delete, mkdir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type DirEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
};

type UploadProgress = {
  fileName: string;
  percent: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

export type SshFileManagerProps = {
  serverId: string;
  visible: boolean;
};

export function SshFileManager({ serverId, visible }: SshFileManagerProps) {
  const { t } = useI18n();
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showMkdir, setShowMkdir] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<DirEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listAbortRef = useRef<AbortController | null>(null);

  // ── Load directory listing ───────────────────────────────────

  const loadDir = useCallback(
    async (path: string) => {
      if (listAbortRef.current) listAbortRef.current.abort();
      const ac = new AbortController();
      listAbortRef.current = ac;

      setLoading(true);
      setError("");
      try {
        const data = await csrfFetch(`/api/servers/${serverId}/sftp/list`, {
          method: "POST",
          body: JSON.stringify({ path }),
          signal: ac.signal,
        });
        setCurrentPath(data.path);
        setEntries(data.entries || []);
      } catch (err) {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to list directory");
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [serverId],
  );

  // Load home directory on first visible
  useEffect(() => {
    if (visible && !currentPath) {
      // Default to /root or / for root SSH sessions
      loadDir("/root").catch(() => {
        // If /root fails, try /
        loadDir("/").catch(() => {});
      });
    }
  }, [visible, currentPath, loadDir]);

  // ── Breadcrumb navigation ────────────────────────────────────

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      loadDir("/");
      return;
    }
    const path = "/" + breadcrumbs.slice(0, index + 1).join("/");
    loadDir(path);
  }

  function navigateInto(dirName: string) {
    const newPath = currentPath.replace(/\/$/, "") + "/" + dirName;
    loadDir(newPath);
  }

  // ── Upload ───────────────────────────────────────────────────

  const handleUpload = useCallback(
    async (files: FileList) => {
      const dir = currentPath.replace(/\/$/, "");
      const newUploads: UploadProgress[] = Array.from(files).map((f) => ({
        fileName: f.name,
        percent: 0,
        status: "uploading",
      }));
      setUploads((prev) => [...prev, ...newUploads]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("path", dir);

        try {
          // Use XMLHttpRequest for progress tracking
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `/api/servers/${serverId}/sftp/upload`);
            xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                setUploads((prev) =>
                  prev.map((u, idx) =>
                    idx === prev.length - files.length + i
                      ? { ...u, percent }
                      : u,
                  ),
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                setUploads((prev) =>
                  prev.map((u, idx) =>
                    idx === prev.length - files.length + i
                      ? { ...u, status: "done", percent: 100 }
                      : u,
                  ),
                );
                resolve();
              } else {
                const msg = `Upload failed (${xhr.status})`;
                setUploads((prev) =>
                  prev.map((u, idx) =>
                    idx === prev.length - files.length + i
                      ? { ...u, status: "error", error: msg }
                      : u,
                  ),
                );
                reject(new Error(msg));
              }
            };

            xhr.onerror = () => {
              const msg = "Network error during upload";
              setUploads((prev) =>
                prev.map((u, idx) =>
                  idx === prev.length - files.length + i
                    ? { ...u, status: "error", error: msg }
                    : u,
                ),
              );
              reject(new Error(msg));
            };

            xhr.send(formData);
          });
        } catch {
          // Error already handled in callbacks above
        }
      }

      // Refresh directory listing after uploads complete
      loadDir(currentPath);

      // Clear completed uploads after 3s
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.status === "uploading"));
      }, 3000);
    },
    [currentPath, serverId, loadDir],
  );

  function getCsrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1] ?? "") : "";
  }

  // ── Download ─────────────────────────────────────────────────

  function handleDownload(entry: DirEntry) {
    if (!entry.isFile) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;
    // Trigger download via hidden iframe to avoid navigation
    const url = `/api/servers/${serverId}/sftp/download?path=${encodeURIComponent(filePath)}&csrf=${getCsrfToken()}`;
    // Use window.open for download
    window.open(url, "_blank");
  }

  // ── Delete ───────────────────────────────────────────────────

  async function handleDelete(entry: DirEntry) {
    if (!entry.isFile) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;

    try {
      await csrfFetch(
        `/api/servers/${serverId}/sftp/delete?path=${encodeURIComponent(filePath)}`,
        { method: "DELETE" },
      );
      setPendingDeleteEntry(null);
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // ── Mkdir ────────────────────────────────────────────────────

  async function handleMkdir() {
    const name = mkdirName.trim();
    if (!name) return;
    const newPath = currentPath.replace(/\/$/, "") + "/" + name;
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/mkdir`, {
        method: "POST",
        body: JSON.stringify({ path: newPath }),
      });
      setShowMkdir(false);
      setMkdirName("");
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mkdir failed");
    }
  }

  // ── Rename ───────────────────────────────────────────────────

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const oldPath = currentPath.replace(/\/$/, "") + "/" + renameTarget;
    const newPath = currentPath.replace(/\/$/, "") + "/" + renameValue.trim();
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/rename`, {
        method: "POST",
        body: JSON.stringify({ oldPath, newPath }),
      });
      setRenameTarget(null);
      setRenameValue("");
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  // ── Drag and drop ────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }

  // ── File size formatting ─────────────────────────────────────

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function formatDate(unix: number): string {
    if (!unix) return "";
    return new Date(unix * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ── Render ───────────────────────────────────────────────────

  if (!visible) return null;

  return (
    <div
      className="flex max-h-[50vh] w-full shrink-0 flex-col gap-2 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-72"
      data-testid={`ssh-file-manager-${serverId}`}
    >
      {/* Header + breadcrumbs */}
      <div className="rounded-xl border border-[var(--border-subtle)] light:border-slate-200/60 bg-[var(--surface-subtle)] light:bg-slate-50/50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)] light:text-slate-900" aria-hidden="true">📁</span>
          <span className="text-sm font-medium text-[var(--text-primary)] light:text-slate-900">{t("sshFileManager.title")}</span>
          <button
            type="button"
            onClick={() => setShowMkdir(!showMkdir)}
            className="ml-auto min-h-9 rounded-full border border-[var(--border-subtle)] light:border-slate-200 px-2 py-0.5 text-xs text-[var(--text-secondary)] light:text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50"
            aria-label={t("sshFileManager.newFolder")}
            title={t("sshFileManager.newFolder")}
          >
            📂+
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-9 rounded-full border border-[var(--color-action-border)]/20 px-2 py-0.5 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20"
          >
            {t("sshFileManager.upload")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </div>

        {/* Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-0.5 text-xs">
          <button
            type="button"
            onClick={() => navigateToBreadcrumb(-1)}
            className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]"
          >
            /
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => navigateToBreadcrumb(i)}
                className="rounded px-1.5 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--color-action-fg)]"
              >
                {crumb}
              </button>
              {i < breadcrumbs.length - 1 && (
                <span className="text-[var(--text-muted)]">/</span>
              )}
            </span>
          ))}
        </div>

        {/* Mkdir input */}
        {showMkdir && (
          <div className="mt-2 flex gap-1.5">
            <input
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
              placeholder={t("sshFileManager.folderName")}
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/30"
              autoFocus
            />
            <button
              onClick={handleMkdir}
              aria-label={t("common.confirm")}
              data-tone="cyan"
              className="min-h-9 min-w-9 shrink-0 rounded-lg border border-[var(--color-action-border)]/20 px-2 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20"
            >
              ✓
            </button>
            <button
              onClick={() => { setShowMkdir(false); setMkdirName(""); }}
              aria-label={t("common.cancel")}
              className="min-h-9 min-w-9 shrink-0 rounded-lg border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-rose-400/20 px-3 py-2 text-xs text-rose-200">
          ❌ {error}
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-2">
          {uploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={`min-w-16 shrink-0 truncate ${u.status === "error" ? "text-rose-300" : u.status === "done" ? "text-emerald-300" : "text-[var(--text-secondary)]"}`}>
                {u.fileName}
              </span>
              {u.status === "uploading" && (
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                  <div
                    className="h-full bg-[var(--color-action-bg)] transition-all"
                    style={{ width: `${u.percent}%` }}
                  />
                </div>
              )}
              {u.status === "done" && <span className="text-emerald-300">✓</span>}
              {u.status === "error" && <span className="text-rose-300 text-[10px]">{u.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* File list with drag-drop zone */}
      <div
        className={`flex-1 overflow-y-auto rounded-xl border p-2 transition ${
          dragOver
            ? "border-[var(--color-action-border)]/40 bg-[var(--color-action-bg)]/5"
            : "border-[var(--border-subtle)] bg-[var(--surface-subtle)]"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ minHeight: "200px" }}
      >
        {dragOver && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-action-fg)]">
            📥 {t("sshFileManager.dropHere")}
          </div>
        )}

        {!dragOver && loading && (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            {t("sshFileManager.loading")}
          </div>
        )}

        {!dragOver && !loading && entries.length === 0 && !error && (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            {t("sshFileManager.empty")}
          </div>
        )}

        {!dragOver && !loading && entries.map((entry) => (
          <div
            key={entry.name}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-[var(--surface-hover)] ${
              selectedEntry === entry.name ? "bg-[var(--surface-elevated)]" : ""
            }`}
            onClick={() => setSelectedEntry(entry.name)}
            onDoubleClick={() => {
              if (entry.isDirectory) navigateInto(entry.name);
              else handleDownload(entry);
            }}
          >
            <span className="shrink-0" aria-hidden="true">
              {entry.isDirectory ? "📁" : entry.isSymlink ? "🔗" : "📄"}
            </span>
            {renameTarget === entry.name ? (
              <div className="flex flex-1 items-center gap-1">
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") { setRenameTarget(null); setRenameValue(""); }
                  }}
                  className="min-h-7 min-w-0 flex-1 rounded border border-[var(--color-action-border)]/30 bg-[var(--surface-hover)] px-2 text-xs text-[var(--text-primary)] outline-none"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); handleRename(); }}
                  aria-label={t("common.confirm")}
                  className="text-[var(--color-action)] hover:text-[var(--color-action-fg)]"
                >✓</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setRenameTarget(null); setRenameValue(""); }}
                  aria-label={t("common.cancel")}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >✕</button>
              </div>
            ) : (
              <span className={`min-w-0 flex-1 truncate ${entry.isDirectory ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                {entry.name}
              </span>
            )}
            {renameTarget !== entry.name && (
              <>
                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                  {entry.isFile ? formatSize(entry.size) : ""}
                </span>
                <span className="hidden shrink-0 text-[10px] text-[var(--text-muted)] lg:block">
                  {formatDate(entry.modifyTime)}
                </span>
                {/* Action buttons */}
                {entry.isFile && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                    className="shrink-0 text-[var(--text-muted)] opacity-0 transition hover:text-[var(--color-action)] group-hover:opacity-100"
                    aria-label={t("sshFileManager.download")}
                    title={t("sshFileManager.download")}
                  >⬇</button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameTarget(entry.name);
                    setRenameValue(entry.name);
                  }}
                  className="shrink-0 text-[var(--text-muted)] opacity-0 transition hover:text-[var(--color-action)] group-hover:opacity-100"
                  aria-label={t("sshFileManager.rename")}
                  title={t("sshFileManager.rename")}
                >✎</button>
                {entry.isFile && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteEntry(entry); }}
                    className="shrink-0 text-[var(--text-muted)] opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
                    aria-label={t("sshFileManager.delete")}
                    title={t("sshFileManager.delete")}
                  >🗑</button>
                )}
              </>
            )}
          </div>
        ))}

        {!dragOver && !loading && entries.length > 0 && (
          <div className="mt-2 border-t border-[var(--border-subtle)] pt-1 text-center text-[10px] text-[var(--text-muted)]">
            {t("sshFileManager.dragHint")}
          </div>
        )}
      </div>
      {pendingDeleteEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="ssh-file-delete-title" className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
            <h3 id="ssh-file-delete-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("common.confirmDelete")}</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{t("sshFileManager.confirmDelete").replace("{name}", pendingDeleteEntry.name)}</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPendingDeleteEntry(null)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{t("common.cancel")}</button>
              <button type="button" onClick={() => void handleDelete(pendingDeleteEntry)} className="min-h-11 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-rose-400">{t("common.confirmDelete")}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
