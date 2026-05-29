"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { AnnouncementEditModal } from "./announcement-edit-modal";
import { Pencil, Trash2 } from "lucide-react";

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

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条公告吗？")) return;
    try {
      const res = await csrfFetch(`/api/announcements?id=${id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silent
    }
  };

  const handleSaved = (updated: Announcement) => {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return (
    <>
      <div className="grid gap-4">
        {items.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-500 light:border-slate-200 light:bg-slate-50">
            暂无公告
          </div>
        ) : (
          items.map((a) => (
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
                      <button onClick={() => handleDelete(a.id)} title="删除" className="rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed light:text-slate-600">{a.body}</p>
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
