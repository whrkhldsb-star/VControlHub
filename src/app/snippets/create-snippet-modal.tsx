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

export function CreateSnippetModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: Snippet) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const data = await csrfFetch<{ snippet: Snippet }>("/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          language: language.trim() || undefined,
          description: description.trim() || undefined,
          tags: tags.length ? tags : undefined,
          isPrivate,
        }),
      });
      onCreated(data.snippet);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 light:bg-slate-900/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c14] p-6 shadow-2xl light:border-slate-200 light:bg-white">
        <h3 className="text-lg font-semibold text-white light:text-slate-900">新建代码片段</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 light:focus:border-slate-200 light:bg-slate-50 light:text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 light:text-slate-500">语言</label>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="例如 javascript、python（留空默认 text）"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50 placeholder:text-slate-600 light:border-slate-200 light:bg-slate-50 light:text-slate-900"
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
            onClick={handleCreate}
            disabled={saving || !title.trim() || !content.trim()}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
