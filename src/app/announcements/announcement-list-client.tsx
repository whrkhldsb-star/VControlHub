"use client";

import { useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
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
  urgent: "border-rose-400/20 bg-rose-400/[0.04]",
};

const levelLabels: Record<string, string> = {
  info: "ℹ️ 信息",
  warning: "⚠️ 警告",
  urgent: "🔴 紧急",
};

export function AnnouncementList({
  items: initial,
  canManage,
}: {
  items: Announcement[];
  canManage: boolean;
}) {
  const { addToast } = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
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

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/announcements?id=${pendingDelete.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      setPendingDelete(null);
      addToast("success", "公告已删除");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除公告失败");
    } finally {
      setDeleteBusy(false);
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
            className="w-full rounded-lg border border-white/10 light:border-slate-200 bg-white/[0.04] pl-9 pr-4 py-2 text-sm text-white light:text-slate-900 outline-none placeholder:text-slate-600 light:placeholder:text-slate-500"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-lg border border-white/10 light:border-slate-200 bg-white/[0.04] px-3 py-2 text-sm text-white light:text-slate-900 outline-none"
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
                  <h2 className="mt-1 text-base font-semibold text-white light:text-slate-900">{a.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">{new Date(a.startsAt).toLocaleDateString("zh-CN")}</span>
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(a)} title="编辑" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { setPendingDelete(a); setDeleteError(null); }} title="删除" aria-label={`删除公告 ${a.title}`} className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300 light:text-slate-700 whitespace-pre-wrap leading-relaxed">{a.body}</p>
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

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 light:bg-white/70 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-announcement-title" className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-slate-950 light:bg-white p-5 shadow-2xl shadow-black/30">
            <h3 id="delete-announcement-title" className="text-base font-semibold text-white light:text-slate-900">删除公告</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400 light:text-slate-600">确认删除公告 <span className="font-medium text-slate-100 light:text-slate-900">{pendingDelete.title}</span>？此操作不可恢复。</p>
            {deleteError && <p role="alert" className="mt-3 text-xs text-rose-300">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={deleteBusy} onClick={() => { setPendingDelete(null); setDeleteError(null); }} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 light:text-slate-700 transition hover:bg-white/[0.06] disabled:opacity-50">
                取消
              </button>
              <button type="button" disabled={deleteBusy} onClick={handleDelete} className="rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm font-medium text-rose-100 light:text-rose-900 transition hover:bg-rose-500/25 disabled:opacity-50">
                {deleteBusy ? "正在删除..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
