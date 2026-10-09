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
import { AlertTriangle } from "@/components/icons";

import { SshDeleteDialog } from "./ssh-file-manager-dialogs";
import { SshFileList, SshUploadProgressList } from "./ssh-file-manager-list";
import { DirEntry, getCsrfToken, SshFileManagerHeader, UploadProgress } from "./ssh-file-manager-parts";
import { getErrorMessage } from "@/lib/http/error-message";

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
  const [uploads, setUploads] = useState<Array<UploadProgress & { id: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showMkdir, setShowMkdir] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<DirEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const requestedPathRef = useRef("");
  const displayedPathRef = useRef("");
  useEffect(() => () => {
    requestedPathRef.current = "";
    listAbortRef.current?.abort();
  }, []);

  const loadDir = useCallback(
    async (path?: string, options?: { throwOnError?: boolean }) => {
      if (listAbortRef.current) listAbortRef.current.abort();
      if (requestedPathRef.current !== path) {
        setSelectedEntry(null);
        setRenameTarget(null);
        setRenameValue("");
        setShowMkdir(false);
        setMkdirName("");
        setPendingDeleteEntry(null);
      }
      requestedPathRef.current = path ?? "";
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

        if (ac.signal.aborted) return;
        requestedPathRef.current = data.path;
        displayedPathRef.current = data.path;
        setCurrentPath(data.path);
        setEntries(data.entries || []);
      } catch (err) {
        if (ac.signal.aborted) return;
        requestedPathRef.current = displayedPathRef.current;
        if (options?.throwOnError) throw err;
        setError(
          err instanceof Error
            ? err.message
            : t("sshFileManager.listFailed"),
        );
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [serverId, t],
  );

  useEffect(() => {
    if (!visible || currentPath) return;
    const init = async () => {
      try {
        // Let the server select the configured account's initial directory.
        await loadDir(undefined, { throwOnError: true });
      } catch {
        // An unrestricted account can still browse / if its home is unavailable.
        await loadDir("/");
      }
    };
    void init();
  }, [visible, currentPath, loadDir]);

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      loadDir("/");
      return;
    }
    loadDir("/" + breadcrumbs.slice(0, index + 1).join("/"));
  }

  function navigateInto(dirName: string) {
    loadDir(currentPath.replace(/\/$/, "") + "/" + dirName);
  }

  function navigateUp() {
    const parts = currentPath.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 0) {
      loadDir("/");
      return;
    }
    loadDir("/" + parts.slice(0, -1).join("/"));
  }

  const canGoUp = currentPath.replace(/\/+$/, "") !== "" && currentPath !== "/";

  const handleUpload = useCallback(
    async (files: FileList) => {
      if (loading || !currentPath) return;
      const dir = currentPath;
      const batch = Array.from(files);
      const newUploads = batch.map((file) => ({ id: crypto.randomUUID(), fileName: file.name, percent: 0, status: "uploading" as const }));
      const batchIds = new Set(newUploads.map((item) => item.id));
      setUploads((prev) => [...prev, ...newUploads]);

      for (let i = 0; i < batch.length; i++) {
        const file = batch[i]!;
        const uploadId = newUploads[i]!.id;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("path", dir);

        try {
          await uploadViaXhr(serverId, formData, (update) => {
            setUploads((prev) => prev.map((item) => item.id === uploadId ? { ...item, ...update } : item));
          }, {
            uploadFailed: (status) => t("sshFileManager.uploadFailed", { status }),
            networkError: t("sshFileManager.networkError"),
          });
        } catch {
          // Error state is already reflected in the upload row.
        }
      }

      // Finishing an upload must not navigate back after the user changed folders.
      if (requestedPathRef.current === currentPath) void loadDir(currentPath);
      // Keep failed rows past the auto-clear window — success rows are
      // noise once the refresh lands, but an error the user glanced away
      // from must stay visible (this list is the only error surface).
      setTimeout(() => setUploads((prev) => prev.filter((u) => !batchIds.has(u.id) || u.status !== "done")), 3000);
    },
    [currentPath, loading, serverId, loadDir, t],
  );

  function handleDownload(entry: DirEntry) {
    if (!entry.isFile) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;
    // GET download is session-cookie authenticated (SAFE_METHODS skip CSRF).
    // Do not put csrf_token in the query string (history / access logs / Referer).
    window.open(
      `/api/servers/${serverId}/sftp/download?path=${encodeURIComponent(filePath)}`,
      "_blank",
    );
  }

  async function handleDelete(entry: DirEntry) {
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/delete?path=${encodeURIComponent(filePath)}`, { method: "DELETE" });
      if (requestedPathRef.current !== currentPath) return;
      setPendingDeleteEntry(null);
      loadDir(currentPath);
    } catch (err) {
      if (requestedPathRef.current === currentPath) setError(getErrorMessage(err, t("sshFileManager.deleteFailed")));
    }
  }

  async function handleMkdir() {
    const name = mkdirName.trim();
    if (!name) return;
    const newPath = currentPath.replace(/\/$/, "") + "/" + name;
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/mkdir`, { method: "POST", body: JSON.stringify({ path: newPath }) });
      if (requestedPathRef.current !== currentPath) return;
      setShowMkdir(false);
      setMkdirName("");
      loadDir(currentPath);
    } catch (err) {
      if (requestedPathRef.current === currentPath) setError(getErrorMessage(err, t("sshFileManager.mkdirFailed")));
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const oldPath = currentPath.replace(/\/$/, "") + "/" + renameTarget;
    const newPath = currentPath.replace(/\/$/, "") + "/" + renameValue.trim();
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/rename`, { method: "POST", body: JSON.stringify({ oldPath, newPath }) });
      if (requestedPathRef.current !== currentPath) return;
      setRenameTarget(null);
      setRenameValue("");
      loadDir(currentPath);
    } catch (err) {
      if (requestedPathRef.current === currentPath) setError(getErrorMessage(err, t("sshFileManager.renameFailed")));
    }
  }

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
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  }

  if (!visible) return null;

  return (
    <div className="flex max-h-[50vh] w-full shrink-0 flex-col gap-2 overflow-y-auto lg:ml-3 lg:max-h-none lg:w-72" data-testid={`ssh-file-manager-${serverId}`}>
      <SshFileManagerHeader breadcrumbs={breadcrumbs} disabled={loading || !currentPath} fileInputRef={fileInputRef} mkdirName={mkdirName} onMkdir={handleMkdir} onNavigateToBreadcrumb={navigateToBreadcrumb} onGoUp={canGoUp ? navigateUp : undefined} onSelectFiles={handleUpload} setMkdirName={setMkdirName} setShowMkdir={setShowMkdir} showMkdir={showMkdir} t={t} />
      {error && <div className="flex items-center gap-2 rounded-xl border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" /><span>{error}</span></div>}
      <SshUploadProgressList uploads={uploads} />
      <SshFileList dragOver={dragOver} entries={entries} error={error} loading={loading} onDelete={setPendingDeleteEntry} onDownload={handleDownload} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop} onNavigateInto={navigateInto} onGoUp={canGoUp ? navigateUp : undefined} onRename={handleRename} renameTarget={renameTarget} renameValue={renameValue} selectedEntry={selectedEntry} setRenameTarget={setRenameTarget} setRenameValue={setRenameValue} setSelectedEntry={setSelectedEntry} t={t} />
      <SshDeleteDialog entry={pendingDeleteEntry} onCancel={() => setPendingDeleteEntry(null)} onConfirm={(entry) => void handleDelete(entry)} t={t} />
    </div>
  );
}

function uploadViaXhr(
  serverId: string,
  formData: FormData,
  onUpdate: (update: Partial<UploadProgress>) => void,
  errorMsgs: { uploadFailed: (status: number) => string; networkError: string },
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/servers/${serverId}/sftp/upload`);
    xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      onUpdate({ percent });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onUpdate({ status: "done", percent: 100 });
        resolve();
        return;
      }
      const msg = errorMsgs.uploadFailed(xhr.status);
      onUpdate({ status: "error", error: msg });
      reject(new Error(msg));
    };

    xhr.onerror = () => {
      const msg = errorMsgs.networkError;
      onUpdate({ status: "error", error: msg });
      reject(new Error(msg));
    };

    xhr.send(formData);
  });
}

