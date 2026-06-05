"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

interface StorageNode {
  id: string;
  name: string;
}

export function CreateShareForm({ nodes }: { nodes: StorageNode[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [path, setPath] = useState("");
  const [entryType, setEntryType] = useState<"FILE" | "DIRECTORY">("DIRECTORY");
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const shareUrl = result
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${result.token}`
    : "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 不可用时静默，用户仍可手动复制下方文本 */
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = { storageNodeId: nodeId, path, entryType };
      if (name.trim()) body.name = name.trim();
      if (expiresIn) body.expiresInHours = Number(expiresIn);
      const data = await csrfFetch<{ token: string }>("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setResult({ token: data.token });
      setPath("");
      setName("");
      setExpiresIn("");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500"
        >
          + 高级创建分享链接
        </button>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white light:text-slate-900">高级分享链接</h3>
              <p className="mt-1 text-xs text-slate-500">选择存储节点和路径。目录分享会公开列出该路径下已索引文件，访问者可逐个下载。</p>
            </div>
            <button onClick={() => { setOpen(false); setResult(null); setError(""); }} className="text-xs text-slate-500 hover:text-slate-300">收起</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">存储节点</label>
              <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none light:border-slate-200 light:bg-slate-50 light:text-slate-900">
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">访问路径</label>
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={entryType === "DIRECTORY" ? "如 /public 或 /docs" : "如 /docs/readme.md"} className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">分享类型</label>
              <select value={entryType} onChange={(e) => setEntryType(e.target.value as "FILE" | "DIRECTORY")} className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none light:border-slate-200 light:bg-slate-50 light:text-slate-900">
                <option value="DIRECTORY">目录：允许访问路径下所有已索引文件</option>
                <option value="FILE">单文件：只允许下载该文件</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">名称（可选）</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 light:text-slate-600 mb-1">有效期（小时，空=永久）</label>
              <input type="number" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} placeholder="72" className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900" />
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          {result && (
            <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
              <p className="text-xs text-emerald-300 light:text-emerald-700 font-medium">✅ 分享链接已创建</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="block flex-1 break-all text-xs text-emerald-200 light:text-emerald-800/80">{shareUrl || `/share/${result.token}`}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-100 light:text-emerald-900 transition hover:bg-emerald-400/20"
                >
                  {copied ? "已复制 ✓" : "复制链接"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">请妥善保存 token，数据库仅存储哈希，无法再次查看。</p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={saving || !nodeId || !path.trim()}
            className="mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? "创建中…" : "创建"}
          </button>
        </div>
      )}
    </div>
  );
}
