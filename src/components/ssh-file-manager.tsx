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

import { SshDeleteDialog } from "./ssh-file-manager-dialogs";
import { SshFileList, SshUploadProgressList } from "./ssh-file-manager-list";
import { DirEntry, getCsrfToken, SshFileManagerHeader, UploadProgress } from "./ssh-file-manager-parts";

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
        if (!ac.signal.aborted) setError(err instanceof Error ? err.message : "Failed to list directory");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    if (!visible || currentPath) return;
    const init = async () => {
      try {
        await loadDir("/root");
      } catch {
        // /root not accessible — fall back to the filesystem root.
        await loadDir("/").catch(() => {});
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
      const dir = currentPath.replace(/\/$/, "");
      const newUploads: UploadProgress[] = Array.from(files).map((f) => ({ fileName: f.name, percent: 0, status: "uploading" }));
      setUploads((prev) => [...prev, ...newUploads]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const formData = new FormData();
        formData.append("file", file);
        formData.append("path", dir);

        try {
          await uploadViaXhr(serverId, formData, files.length, i, setUploads, {
            uploadFailed: (status) => t("sshFileManager.uploadFailed").replace("{status}", String(status)),
            networkError: t("sshFileManager.networkError"),
          });
        } catch {
          // Error state is already reflected in the upload row.
        }
      }

      loadDir(currentPath);
      setTimeout(() => setUploads((prev) => prev.filter((u) => u.status === "uploading")), 3000);
    },
    [currentPath, serverId, loadDir, t],
  );

  function handleDownload(entry: DirEntry) {
    if (!entry.isFile) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;
    window.open(`/api/servers/${serverId}/sftp/download?path=${encodeURIComponent(filePath)}&csrf=${getCsrfToken()}`, "_blank");
  }

  async function handleDelete(entry: DirEntry) {
    if (!entry.isFile) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entry.name;
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/delete?path=${encodeURIComponent(filePath)}`, { method: "DELETE" });
      setPendingDeleteEntry(null);
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleMkdir() {
    const name = mkdirName.trim();
    if (!name) return;
    const newPath = currentPath.replace(/\/$/, "") + "/" + name;
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/mkdir`, { method: "POST", body: JSON.stringify({ path: newPath }) });
      setShowMkdir(false);
      setMkdirName("");
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mkdir failed");
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    const oldPath = currentPath.replace(/\/$/, "") + "/" + renameTarget;
    const newPath = currentPath.replace(/\/$/, "") + "/" + renameValue.trim();
    try {
      await csrfFetch(`/api/servers/${serverId}/sftp/rename`, { method: "POST", body: JSON.stringify({ oldPath, newPath }) });
      setRenameTarget(null);
      setRenameValue("");
      loadDir(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
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
      <SshFileManagerHeader breadcrumbs={breadcrumbs} fileInputRef={fileInputRef} mkdirName={mkdirName} onMkdir={handleMkdir} onNavigateToBreadcrumb={navigateToBreadcrumb} onGoUp={canGoUp ? navigateUp : undefined} onSelectFiles={handleUpload} setMkdirName={setMkdirName} setShowMkdir={setShowMkdir} showMkdir={showMkdir} t={t} />
      {error && <div className="rounded-xl border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]">❌ {error}</div>}
      <SshUploadProgressList uploads={uploads} />
      <SshFileList dragOver={dragOver} entries={entries} error={error} loading={loading} onDelete={setPendingDeleteEntry} onDownload={handleDownload} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop} onNavigateInto={navigateInto} onGoUp={canGoUp ? navigateUp : undefined} onRename={handleRename} renameTarget={renameTarget} renameValue={renameValue} selectedEntry={selectedEntry} setRenameTarget={setRenameTarget} setRenameValue={setRenameValue} setSelectedEntry={setSelectedEntry} t={t} />
      <SshDeleteDialog entry={pendingDeleteEntry} onCancel={() => setPendingDeleteEntry(null)} onConfirm={(entry) => void handleDelete(entry)} t={t} />
    </div>
  );
}

function uploadViaXhr(
  serverId: string,
  formData: FormData,
  fileCount: number,
  fileIndex: number,
  setUploads: React.Dispatch<React.SetStateAction<UploadProgress[]>>,
  errorMsgs: { uploadFailed: (status: number) => string; networkError: string },
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/servers/${serverId}/sftp/upload`);
    xhr.setRequestHeader("X-CSRF-Token", getCsrfToken());

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      setUploads((prev) => updateUploadAt(prev, fileCount, fileIndex, { percent }));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploads((prev) => updateUploadAt(prev, fileCount, fileIndex, { status: "done", percent: 100 }));
        resolve();
        return;
      }
      const msg = errorMsgs.uploadFailed(xhr.status);
      setUploads((prev) => updateUploadAt(prev, fileCount, fileIndex, { status: "error", error: msg }));
      reject(new Error(msg));
    };

    xhr.onerror = () => {
      const msg = errorMsgs.networkError;
      setUploads((prev) => updateUploadAt(prev, fileCount, fileIndex, { status: "error", error: msg }));
      reject(new Error(msg));
    };

    xhr.send(formData);
  });
}

function updateUploadAt(prev: UploadProgress[], fileCount: number, fileIndex: number, update: Partial<UploadProgress>) {
  return prev.map((u, idx) => (idx === prev.length - fileCount + fileIndex ? { ...u, ...update } : u));
}
