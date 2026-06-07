"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

interface Snippet {
  id: string;
  title: string;
  content: string;
  language: string;
  description: string | null;
  tags: string[];
  isPrivate: boolean;
}

export function SnippetEditModal({
  snippet,
  onClose,
  onSaved,
}: {
  snippet: Snippet;
  onClose: () => void;
  onSaved: (updated: Snippet) => void;
}) {
  const [title, setTitle] = useState(snippet.title);
  const [content, setContent] = useState(snippet.content);
  const [language, setLanguage] = useState(snippet.language);
  const [description, setDescription] = useState(snippet.description ?? "");
  const [tagsInput, setTagsInput] = useState(snippet.tags.join(", "));
  const [isPrivate, setIsPrivate] = useState(snippet.isPrivate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const data = await csrfFetch<{ snippet: Snippet }>("/api/snippets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: snippet.id, title, content, language, description, tags, isPrivate }),
      });
      onSaved(data.snippet);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 light:bg-slate-900/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-snippet-title"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-2xl light:border-slate-200 light:bg-white"
      >
        <h3 id="edit-snippet-title" className="text-lg font-semibold text-white light:text-slate-900">编辑代码片段</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 light:focus:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">语言</label>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 light:focus:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">描述（可选）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明此片段的用途"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">标签（用逗号分隔）</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如 备份, nginx"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-slate-300 outline-none focus:border-cyan-400/50 light:focus:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 light:text-slate-500">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded border-white/20"
            />
            仅自己可见
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-400 transition hover:bg-white/5 light:border-slate-200 light:text-slate-500"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
