"use client";

import { useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { SnippetEditModal } from "./snippet-edit-modal";
import { Pencil, Trash2, Copy, Check, Search } from "lucide-react";

interface Snippet {
  id: string;
  title: string;
  content: string;
  language: string;
  description: string | null;
  tags: string[];
  isPrivate: boolean;
}

export function SnippetList({ snippets: initial }: { snippets: Snippet[] }) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("ALL");

  // Extract unique languages
  const languages = useMemo(() => {
    const langs = new Set(items.map((s) => s.language));
    return ["ALL", ...Array.from(langs).sort()];
  }, [items]);

  // Filter items
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((s) => {
      if (langFilter !== "ALL" && s.language !== langFilter) return false;
      if (q && !s.title.toLowerCase().includes(q) && !s.content.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q) && !s.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, search, langFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个代码片段吗？")) return;
    try {
      await csrfFetch(`/api/snippets?id=${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // silent
    }
  };

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaved = (updated: Snippet) => {
    setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <>
      {/* Search and filter bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题、内容、标签…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-4 py-2 text-sm text-white outline-none placeholder:text-slate-600"
          />
        </div>
        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
        >
          {languages.map((l) => (
            <option key={l} value={l}>{l === "ALL" ? "全部语言" : l}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} 条</span>
      </div>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <div key={s.id} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-white/[0.12]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <b className="text-sm text-white">{s.title}</b>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">{s.language}</span>
                {s.isPrivate && <span className="text-[10px] text-amber-400">🔒 私有</span>}
                {s.tags.length > 0 && (
                  <div className="flex gap-1">
                    {s.tags.map((t) => (
                      <span key={t} className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button onClick={() => handleCopy(s.content, s.id)} title="复制" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400">
                  {copiedId === s.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button onClick={() => setEditing(s)} title="编辑" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400">
                  <Pencil size={14} />
                </button>
                <button onClick={() => handleDelete(s.id)} title="删除" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {s.description && <p className="mt-1 text-xs text-slate-500">{s.description}</p>}
            <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/30 p-3 text-xs text-slate-300">{s.content}</pre>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-500">
            {items.length === 0 ? "暂无代码片段" : "无匹配结果"}
          </div>
        )}
      </div>

      {editing && (
        <SnippetEditModal
          snippet={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
