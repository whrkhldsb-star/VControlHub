"use client";

import { useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { AnnouncementEditModal } from "./announcement-edit-modal";
import { Pencil, Trash2, Search } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  startsAt: string;
  expiresAt: string | null;
}

const levelColors: Record<string, string> = {
  info: "border-cyan-400/20 bg-cyan-400/[0.04]",
  warning: "border-amber-400/20 bg-amber-400/[0.04]",
  critical: "border-rose-400/20 bg-rose-400/[0.04]",
  urgent: "border-rose-400/20 bg-rose-400/[0.04]",
};

const levelLabels: Record<string, string> = {
  info: "ℹ️ 信息",
  warning: "⚠️ 警告",
  critical: "🔴 严重",
  urgent: "🔴 紧急",
};

export function AnnouncementList({
  items: initial,
  canManage,
}: {
  items: Announcement[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");

  const levels = useMemo(() => {
    const lvs = new Set(items.map((a) => a.level));
    return ["ALL", ...Array.from(lvs).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items
      .filter((a) => {
        if (levelFilter !== "ALL" && a.level !== levelFilter) return false;
        if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
      });
  }, [items, search, levelFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条公告吗？")) return;
    try {
      await csrfFetch(`/api/announcements?id=${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silent
    }
  };

  const handleSaved = (updated: Announcement) => {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
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
            placeholder="搜索公告标题、内容…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-4 py-2 text-sm text-white outline-none placeholder:text-slate-600"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
        >
          {levels.map((l) => (
            <option key={l} value={l}>{l === "ALL" ? "全部级别" : levelLabels[l] ?? l}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} 条</span>
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-500">
            {items.length === 0 ? "暂无公告" : "无匹配结果"}
          </div>
        ) : (
          filtered.map((a) => (
            <div key={a.id} className={`group relative rounded-xl border p-5 ${levelColors[a.level] ?? levelColors.info}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {a.pinned && <span className="text-xs text-amber-400">📌 置顶</span>}
                    <span className="text-xs text-slate-500">{levelLabels[a.level] ?? a.level}</span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-white">{a.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(a.startsAt).toLocaleDateString("zh-CN")}</span>
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(a)} title="编辑" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(a.id)} title="删除" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{a.body}</p>
              {a.expiresAt && (
                <p className="mt-3 text-xs text-slate-500">有效期至 {new Date(a.expiresAt).toLocaleString("zh-CN")}</p>
              )}
            </div>
          ))
        )}
      </div>

      {editing && (
        <AnnouncementEditModal
          announcement={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
