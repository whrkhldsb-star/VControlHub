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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-snippet-title"
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[var(--modal-bg)] p-6 shadow-2xl light:border-slate-200"
      >
        <h3 id="create-snippet-title" className="text-lg font-semibold text-white">新建代码片段</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="create-snippet-title-input" className="block text-xs text-slate-400 light:text-slate-500">标题</label>
            <input
              id="create-snippet-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              data-input
				className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-language-input" className="block text-xs text-slate-400 light:text-slate-500">语言</label>
            <input
              id="create-snippet-language-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="例如 javascript、python（留空默认 text）"
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-description-input" className="block text-xs text-slate-400 light:text-slate-500">描述（可选）</label>
            <input
              id="create-snippet-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明此片段的用途"
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-tags-input" className="block text-xs text-slate-400 light:text-slate-500">标签（用逗号分隔）</label>
            <input
              id="create-snippet-tags-input"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例如 备份, nginx"
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-content-input" className="block text-xs text-slate-400 light:text-slate-500">内容</label>
            <textarea
              id="create-snippet-content-input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
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
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
