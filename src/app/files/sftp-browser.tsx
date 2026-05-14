"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

type SftpNode = {
  id: string;
  name: string;
  driver: string;
};

type SftpListEntry = {
  name: string;
  longname: string;
  type: "file" | "directory" | "other";
  size: number;
  modifyTime: number;
  accessTime: number;
};

type SftpListResponse = {
  nodeId: string;
  nodeName: string;
  remotePath: string;
  entries: SftpListEntry[];
};

type SyncResult = {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
};

type SftpBrowserProps = {
  sftpNodes: SftpNode[];
};

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  const size = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "-";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function joinPath(base: string, segment: string): string {
  if (!base || base === "/") return `/${segment}`;
  const cleanBase = base.replace(/\/+$/, "");
  return `${cleanBase}/${segment}`;
}

function splitPathSegments(path: string) {
  return path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getEntryIcon(type: SftpListEntry["type"]): string {
  switch (type) {
    case "directory":
      return "📁";
    case "file":
      return "📄";
    default:
      return "📎";
  }
}

function buildSftpDownloadHref(nodeId: string, remotePath: string): string {
  const params = new URLSearchParams({ nodeId, path: remotePath });
  return `/api/storage/sftp-download?${params.toString()}`;
}

function buildSftpDownloadUrl(nodeId: string, remotePath: string): string {
  return `${buildSftpDownloadHref(nodeId, remotePath)}&download=1`;
}

function guessFileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (!ext) return "📄";
  if (["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "ico"].includes(ext)) return "🖼️";
  if (["mp4", "webm", "mkv", "avi", "mov"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📄";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "📦";
  return "📄";
}

const VIEWABLE_EXTENSIONS = new Set([
  "txt", "md", "json", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm",
  "xml", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "sh", "bash",
  "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "php", "pl",
  "sql", "log", "csv", "vue", "svelte", "dockerfile", "gitignore",
  "makefile", "cmake", "gradle", "properties", "bat", "ps1",
]);

function isViewableTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (VIEWABLE_EXTENSIONS.has(lower)) return true;
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return ext ? VIEWABLE_EXTENSIONS.has(ext) : false;
}

/* ------------------------------------------------------------------ */
/* File Editor Modal */
/* ------------------------------------------------------------------ */

function FileEditorModal({
  nodeId,
  filePath,
  fileName,
  onClose,
}: {
  nodeId: string;
  filePath: string;
  fileName: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await csrfFetch("/api/storage/sftp-ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", nodeId, path: filePath }),
        });
        if (data.encoding === "base64") {
          throw new Error("该文件为二进制格式，不支持在线编辑。");
        }
        if (!cancelled) {
          setContent(data.content);
          setOriginalContent(data.content);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取文件失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [nodeId, filePath]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await csrfFetch("/api/storage/sftp-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", nodeId, path: filePath, content }),
      });
      setOriginalContent(content);
      setSuccess("保存成功");
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存文件失败");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-900 shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">📝 {fileName}</h3>
            <p className="mt-1 text-xs text-slate-400">路径：{filePath}</p>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                未保存
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {/* Error / Success */}
        {error && (
          <div className="mx-6 mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200">
            ❌ {error}
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            ✅ {success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-slate-300 py-10 justify-center">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              正在读取文件内容…
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full min-h-[400px] rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-sm text-slate-100 focus:border-cyan-400/50 focus:outline-none resize-y"
              spellCheck={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline Rename Form */
/* ------------------------------------------------------------------ */

function InlineRenameForm({
  currentName,
  onConfirm,
  onCancel,
  loading,
}: {
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState(currentName);

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim() && name.trim() !== currentName) {
            onConfirm(name.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
        className="w-32 rounded-xl border border-cyan-400/30 bg-slate-950 px-2 py-1 text-xs text-white focus:border-cyan-400/50 focus:outline-none"
        autoFocus
        disabled={loading}
      />
      <button
        type="button"
        onClick={() => name.trim() && name.trim() !== currentName && onConfirm(name.trim())}
        disabled={loading || !name.trim() || name.trim() === currentName}
        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
      >
        {loading ? "..." : "✓"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline Delete Confirm */
/* ------------------------------------------------------------------ */

function InlineDeleteConfirm({
  entryName,
  isDirectory,
  onConfirm,
  onCancel,
  loading,
}: {
  entryName: string;
  isDirectory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-rose-200">
        {isDirectory ? "删除目录" : "删除"}「{entryName}」？
      </span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-400/20 disabled:opacity-50"
      >
        {loading ? "..." : "确认"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
      >
        取消
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Component */
/* ------------------------------------------------------------------ */

export function SftpBrowser({ sftpNodes }: SftpBrowserProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [remotePath, setRemotePath] = useState<string>("/");
  const [entries, setEntries] = useState<SftpListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState<string>("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncRecursive, setSyncRecursive] = useState(false);

  // Rename state
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);

  // Delete state
  const [deletingEntry, setDeletingEntry] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

 // File editor state
 const [editingFile, setEditingFile] = useState<{ path: string; name: string } | null>(null);

 // Direct connect state
 const [directConnect, setDirectConnect] = useState(false);
 const [proxyInfo, setProxyInfo] = useState<{ port: number; accessToken: string; publicUrl: string } | null>(null);
 const [proxyLoading, setProxyLoading] = useState(false);
 const [proxyError, setProxyError] = useState<string | null>(null);

 const router = useRouter();

 const fetchDirectory = useCallback(
 async (nodeId: string, path: string) => {
 if (!nodeId) return;
 setLoading(true);
 setError(null);
 try {
  const params = new URLSearchParams({ nodeId, path });
 const data = await csrfFetch(`/api/files/sftp-list?${params.toString()}`) as SftpListResponse;
 setEntries(data.entries);
 setNodeName(data.nodeName);
 setRemotePath(data.remotePath);
 } catch (err) {
 setError(err instanceof Error ? err.message : "未知错误");
 setEntries([]);
 } finally {
 setLoading(false);
 }
 },
 [],
 );

 /* ── Direct connect proxy management ──────────────────────── */
 const checkProxyStatus = useCallback(async (nodeId: string) => {
 try {
 const data = await csrfFetch(`/api/servers/${nodeId}/file-proxy`) as { status: string; proxy?: { port: number; accessToken: string; publicUrl?: string } };
 if (data.status === "running" && data.proxy) {
 setProxyInfo({ port: data.proxy.port, accessToken: data.proxy.accessToken, publicUrl: data.proxy.publicUrl || "" });
 } else {
 setProxyInfo(null);
 }
 } catch {
 setProxyInfo(null);
 }
 }, []);

 const startProxy = useCallback(async (nodeId: string) => {
 setProxyLoading(true);
 setProxyError(null);
 try {
 const data = await csrfFetch(`/api/servers/${nodeId}/file-proxy`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 }) as { status: string; proxy?: { port: number; accessToken: string; publicUrl?: string }; error?: string };
 if (data.error) {
 setProxyError(data.error);
 setProxyInfo(null);
 } else if (data.proxy) {
 setProxyInfo({ port: data.proxy.port, accessToken: data.proxy.accessToken, publicUrl: data.proxy.publicUrl || "" });
 setProxyError(null);
 }
 } catch (err) {
 setProxyError(err instanceof Error ? err.message : "启动代理失败");
 setProxyInfo(null);
 } finally {
 setProxyLoading(false);
 }
 }, []);

 const stopProxy = useCallback(async (nodeId: string) => {
 setProxyLoading(true);
 try {
 await csrfFetch(`/api/servers/${nodeId}/file-proxy`, { method: "DELETE" });
 setProxyInfo(null);
 } catch {
 // ignore
 } finally {
 setProxyLoading(false);
 }
 }, []);

 const toggleDirectConnect = useCallback(async () => {
 if (!selectedNodeId) return;
 if (directConnect) {
 await stopProxy(selectedNodeId);
 setDirectConnect(false);
 } else {
 await startProxy(selectedNodeId);
 setDirectConnect(true);
 }
 }, [selectedNodeId, directConnect, startProxy, stopProxy]);

 /* eslint-disable react-hooks/set-state-in-effect */
 useEffect(() => {
 if (selectedNodeId) {
 setRemotePath("/");
 fetchDirectory(selectedNodeId, "/");
 } else {
 setEntries([]);
 setNodeName("");
 setError(null);
 }
 }, [selectedNodeId, fetchDirectory]);
 /* eslint-enable react-hooks/set-state-in-effect */

 const handleNodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
 setSelectedNodeId(e.target.value);
 setDirectConnect(false);
 setProxyInfo(null);
 setProxyError(null);
 if (e.target.value) {
 checkProxyStatus(e.target.value);
 }
 };

  const handleNavigate = (entry: SftpListEntry) => {
    if (entry.type !== "directory") return;
    const nextPath = joinPath(remotePath, entry.name);
    fetchDirectory(selectedNodeId, nextPath);
  };

  const handleBreadcrumb = (targetPath: string) => {
    fetchDirectory(selectedNodeId, targetPath);
  };

const handleSync = async () => {
 if (!selectedNodeId || syncLoading) return;
 setSyncLoading(true);
 setSyncResult(null);
 try {
 const data = await csrfFetch("/api/storage/sftp-sync", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ nodeId: selectedNodeId }),
 }) as SyncResult;
 setSyncResult(data);
 router.refresh();
 setTimeout(() => setSyncResult(null), 3000);
 } catch (err) {
 setError(err instanceof Error ? err.message : "同步失败");
 } finally {
 setSyncLoading(false);
 }
 };

  const handleDelete = async (entry: SftpListEntry) => {
    if (!selectedNodeId || deleteLoading) return;
    setDeleteLoading(true);
    setError(null);
    try {
      const fullPath = joinPath(remotePath, entry.name);
      const data = await csrfFetch("/api/storage/sftp-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          nodeId: selectedNodeId,
          path: fullPath,
          isDirectory: entry.type === "directory",
        }),
	});
 setDeletingEntry(null);
 fetchDirectory(selectedNodeId, remotePath);
 } catch (err) {
 setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRename = async (entry: SftpListEntry, newName: string) => {
    if (!selectedNodeId || renameLoading) return;
    setRenameLoading(true);
    setError(null);
    try {
      const oldFullPath = joinPath(remotePath, entry.name);
      const newFullPath = joinPath(remotePath, newName);
      const data = await csrfFetch("/api/storage/sftp-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          nodeId: selectedNodeId,
          path: oldFullPath,
          newPath: newFullPath,
        }),
	});
 setRenamingEntry(null);
 fetchDirectory(selectedNodeId, remotePath);
 } catch (err) {
 setError(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setRenameLoading(false);
    }
  };

  // No SFTP nodes — render nothing
  if (sftpNodes.length === 0) return null;

  const segments = splitPathSegments(remotePath);
  const TABLE_COLS = "grid-cols-[minmax(0,2fr)_100px_100px_140px_minmax(180px,1fr)]";

  return (
    <article className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">🔌 SFTP 远端浏览</h2>
          <p className="mt-2 text-sm leading-7 text-slate-300">
            选择 SFTP 存储节点，实时查看远端文件列表，支持重命名、删除与在线编辑。
          </p>
        </div>

 {/* Node selector + Direct connect toggle */}
 <div className="flex items-center gap-3 flex-wrap">
 <div className="flex items-center gap-3">
 <label htmlFor="sftp-node-select" className="text-sm text-slate-400">
 节点
 </label>
 <select
 id="sftp-node-select"
 value={selectedNodeId}
 onChange={handleNodeChange}
 className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
 >
 <option value="">— 选择 SFTP 节点 —</option>
 {sftpNodes.map((node) => (
 <option key={node.id} value={node.id}>
 {node.name}
 </option>
 ))}
 </select>
 </div>
 {selectedNodeId && (
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={toggleDirectConnect}
 disabled={proxyLoading}
 className={`relative flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition ${
 directConnect
 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
 : "bg-slate-800 text-slate-400 border border-white/10 hover:bg-slate-700"
 } ${proxyLoading ? "opacity-50 cursor-wait" : ""}`}
 >
 {proxyLoading ? (
 <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
 ) : directConnect ? (
 <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
 ) : (
 <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />
 )}
 {directConnect ? "直连模式 ON" : "直连模式"}
 </button>
 {directConnect && proxyInfo && (
 <span className="text-[10px] text-emerald-400/70">
 :{proxyInfo.port}
 </span>
 )}
 </div>
 )}
 </div>
      </div>

      {/* Not selected yet */}
      {!selectedNodeId && (
        <p className="mt-5 text-sm text-slate-400">请先选择一个 SFTP 节点以浏览远端文件。</p>
      )}

      {/* Loading */}
      {selectedNodeId && loading && (
        <div className="mt-5 flex items-center gap-3 text-sm text-slate-300">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          正在连接远端节点…
        </div>
      )}

 {/* Error */}
 {selectedNodeId && error && !loading && (
 <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/5 px-5 py-4 text-sm text-rose-200">
 ❌ {error}
 </div>
 )}

 {/* Proxy error */}
 {proxyError && (
 <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-5 py-3 text-xs text-amber-200">
 ⚠️ 直连代理: {proxyError}
 </div>
 )}

      {/* Breadcrumb + file list */}
      {selectedNodeId && !loading && nodeName && (
        <>
          {/* Breadcrumb navigation */}
          <nav aria-label="SFTP 面包屑" className="mt-5 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <button
              type="button"
              onClick={() => handleBreadcrumb("/")}
              className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
            >
              /
            </button>
            {segments.map((segment, index) => {
              const nextPath = `/${segments.slice(0, index + 1).join("/")}`;
              const isLast = index === segments.length - 1;
              return (
                <span key={nextPath} className="flex items-center gap-2">
                  <span>/</span>
                  {isLast ? (
                    <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
                      {segment}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleBreadcrumb(nextPath)}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
                    >
                      {segment}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>

          {/* Remote path info + Sync controls */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500">
              节点：{nodeName} · 远端路径：{remotePath} · {entries.length} 个条目
            </p>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncLoading || !selectedNodeId}
              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncLoading ? "同步中..." : "扫描同步"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncRecursive}
                onChange={(e) => setSyncRecursive(e.target.checked)}
                className="accent-emerald-400"
              />
              递归子目录
            </label>
          </div>

          {/* Sync result display */}
          {syncResult && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1 text-xs text-emerald-200">
                ✅ 同步完成：新建 {syncResult.created} 个、更新 {syncResult.updated} 个
              </span>
              {syncResult.errors.length > 0 && (
                <span className="rounded-full border border-rose-400/20 bg-rose-400/5 px-3 py-1 text-xs text-rose-200">
                  ❌ {syncResult.errors.length} 个错误
                </span>
              )}
            </div>
          )}

          {/* Entry list */}
          <div className="mt-4 overflow-x-auto overflow-hidden rounded-2xl border border-white/10">
            {/* Table header */}
            <div className={`grid ${TABLE_COLS} bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-400`}>
              <div>名称</div>
              <div>类型</div>
              <div>大小</div>
              <div>修改时间</div>
              <div>操作</div>
            </div>

            {/* Table body */}
            <div className="divide-y divide-white/5 bg-slate-950/40">
              {entries.length === 0 ? (
                <div className="px-4 py-10 text-sm text-slate-400">
                  当前远端目录暂无内容。
                </div>
              ) : null}

              {/* Parent directory shortcut */}
              {remotePath !== "/" && (
                <button
                  type="button"
                  onClick={() => {
                    const parentSegments = segments.slice(0, -1);
                    const parentPath = parentSegments.length > 0
                      ? `/${parentSegments.join("/")}`
                      : "/";
                    handleBreadcrumb(parentPath);
                  }}
                  className={`grid w-full ${TABLE_COLS} items-center gap-4 px-4 py-3 text-sm text-left hover:bg-white/5 transition`}
                >
                  <div className="min-w-0 truncate font-medium text-slate-400">📁 ..</div>
                  <div className="text-slate-500">上级</div>
                  <div className="text-slate-500">-</div>
                  <div className="text-slate-500">-</div>
                  <div className="text-slate-500">-</div>
                </button>
              )}

              {entries
                .slice()
                .sort((a, b) => {
                  if (a.type === "directory" && b.type !== "directory") return -1;
                  if (a.type !== "directory" && b.type === "directory") return 1;
                  return a.name.localeCompare(b.name, "zh-CN");
                })
                .map((entry) => {
                  const entryKey = `${remotePath}/${entry.name}`;
                  const isRenaming = renamingEntry === entryKey;
                  const isDeleting = deletingEntry === entryKey;
                  const fullPath = joinPath(remotePath, entry.name);
                  const isFile = entry.type === "file";
                  const isDir = entry.type === "directory";
                  const canView = isFile && isViewableTextFile(entry.name);

                  return (
                    <div
                      key={entryKey}
                      className={`grid ${TABLE_COLS} items-center gap-4 px-4 py-3 text-sm`}
                    >
                      {/* Name */}
                      <div className="min-w-0">
                        {isRenaming ? (
                          <InlineRenameForm
                            currentName={entry.name}
                            onConfirm={(newName) => handleRename(entry, newName)}
                            onCancel={() => setRenamingEntry(null)}
                            loading={renameLoading}
                          />
                        ) : isDir ? (
                          <button
                            type="button"
                            onClick={() => handleNavigate(entry)}
                            className="block truncate font-medium text-cyan-100 hover:text-cyan-50 text-left"
                          >
                            {getEntryIcon(entry.type)} {entry.name}
                          </button>
                        ) : (
                          <span className="block truncate font-medium text-white">
                            {guessFileIcon(entry.name)} {entry.name}
                          </span>
                        )}
                        {entry.longname && !isRenaming && (
                          <p className="mt-0.5 truncate text-xs text-slate-500">{entry.longname}</p>
                        )}
                      </div>

                      {/* Type */}
                      <div className="text-slate-300">
                        {isDir ? "目录" : isFile ? "文件" : "其他"}
                      </div>

                      {/* Size */}
                      <div className="text-slate-300">
                        {isDir ? "-" : formatFileSize(entry.size)}
                      </div>

                      {/* Modified */}
                      <div className="text-slate-400 text-xs">
                        {formatDate(entry.modifyTime)}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isDeleting ? (
                          <InlineDeleteConfirm
                            entryName={entry.name}
                            isDirectory={isDir}
                            onConfirm={() => handleDelete(entry)}
                            onCancel={() => setDeletingEntry(null)}
                            loading={deleteLoading}
                          />
                        ) : (
                          <>
 {isFile && (
 <a
 href={directConnect && proxyInfo
 ? `${proxyInfo.publicUrl}:${proxyInfo.port}${fullPath}?token=${proxyInfo.accessToken}`
 : buildSftpDownloadUrl(selectedNodeId, fullPath)
 }
 target={directConnect && proxyInfo ? "_blank" : undefined}
 rel={directConnect ? "noopener noreferrer" : undefined}
 className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] text-cyan-100 hover:bg-cyan-400/20"
 >
 下载
 </a>
 )}
                            {canView && (
                              <button
                                type="button"
                                onClick={() => setEditingFile({ path: fullPath, name: entry.name })}
                                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] text-cyan-100 hover:bg-cyan-400/20"
                              >
                                查看
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setRenamingEntry(entryKey)}
                              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] text-amber-100 hover:bg-amber-400/20"
                            >
                              重命名
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingEntry(entryKey)}
                              className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[10px] text-rose-100 hover:bg-rose-400/20"
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}

      {/* File editor modal */}
      {editingFile && (
        <FileEditorModal
          nodeId={selectedNodeId}
          filePath={editingFile.path}
          fileName={editingFile.name}
          onClose={() => setEditingFile(null)}
        />
      )}
    </article>
  );
}
