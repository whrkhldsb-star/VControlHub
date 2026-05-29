"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Star, Tag } from "lucide-react";

export interface MediaItem {
  id: string;
  name: string;
  relativePath: string;
  mediaType: string;
  size: bigint | number | null;
  favorite: boolean;
  tags: string[];
  storageNode?: { name: string; basePath: string; server?: { name: string } | null } | null;
}

function formatSize(bytes: bigint | number | null) {
  if (!bytes) return "未知";
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function storageLabel(m: MediaItem) {
  const node = m.storageNode;
  if (!node) return "未知存储";
  const serverName = node.server?.name ?? "本地";
  return `${serverName} · ${node.basePath}`;
}

export function MediaItemCard({ item, canManage }: { item: MediaItem; canManage: boolean }) {
  const [fav, setFav] = useState(item.favorite);
  const [tags, setTags] = useState(item.tags || []);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTag, setNewTag] = useState("");

  const toggleFav = async () => {
    const next = !fav;
    setFav(next);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
    } catch {
      setFav(!next);
    }
  };

  const addTag = async () => {
    const tag = newTag.trim();
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag];
    setTags(next);
    setNewTag("");
    setShowTagInput(false);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } catch {
      setTags(tags);
    }
  };

  const removeTag = async (t: string) => {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    try {
      await csrfFetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } catch {
      setTags(tags);
    }
  };

  return (
    <div className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-white/[0.12] light:border-slate-200 light:bg-slate-50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span>{item.mediaType === "image" ? "🖼" : "🎬"}</span>
            <span className="truncate text-sm font-medium text-white light:text-slate-900">{item.name}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500" title={item.relativePath}>📂 {item.relativePath}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
            <span>📦 {formatSize(item.size)}</span>
            <span>💾 {storageLabel(item)}</span>
          </div>
        </div>
        {canManage && (
          <button
            onClick={toggleFav}
            className={`shrink-0 rounded p-1 transition ${fav ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-amber-400 opacity-0 group-hover:opacity-100"}`}
            title={fav ? "取消收藏" : "收藏"}
          >
            <Star size={16} fill={fav ? "currentColor" : "none"} />
          </button>
        )}
        {!canManage && fav && <span className="text-amber-400 text-sm">⭐</span>}
      </div>

      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
              {t}
              <button onClick={() => removeTag(t)} className="text-cyan-400/50 hover:text-cyan-300">×</button>
            </span>
          ))}
          {showTagInput ? (
            <input
              autoFocus
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTag(); if (e.key === "Escape") setShowTagInput(false); }}
              onBlur={() => { if (newTag.trim()) addTag(); else setShowTagInput(false); }}
              className="w-20 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white outline-none placeholder:text-slate-600"
              placeholder="标签名"
            />
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-white/10 px-2 py-0.5 text-[10px] text-slate-500 opacity-0 transition group-hover:opacity-100 hover:border-cyan-400/30 hover:text-cyan-400"
            >
              <Tag size={10} /> 添加
            </button>
          )}
        </div>
      )}

      {!canManage && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
