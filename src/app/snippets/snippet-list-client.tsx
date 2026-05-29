"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { SnippetEditModal } from "./snippet-edit-modal";
import { Pencil, Trash2, Copy, Check } from "lucide-react";

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

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个代码片段吗？")) return;
    try {
      const res = await csrfFetch(`/api/snippets?id=${id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((s) => s.id !== id));
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
      <div className="grid gap-3">
        {items.map((s) => (
          <div key={s.id} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-white/[0.12] light:border-slate-200 light:bg-slate-50 light:hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <b className="text-sm text-white light:text-slate-900">{s.title}</b>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400 light:bg-slate-100 light:text-slate-500">{s.language}</span>
                {s.isPrivate && <span className="text-[10px] text-amber-400">🔒 私有</span>}
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
            <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/30 p-3 text-xs text-slate-300 light:bg-slate-100 light:text-slate-700">{s.content}</pre>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-500 light:border-slate-200 light:bg-slate-50">
            暂无代码片段
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
