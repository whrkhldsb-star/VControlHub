"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

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
  const { t } = useI18n();
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
        .map((tag) => tag.trim())
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
      setError(e instanceof Error ? e.message : t("snippetsPage.toast.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-snippet-title"
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-6 shadow-2xl"
      >
        <h3 id="create-snippet-title" className="text-lg font-semibold text-[var(--text-primary)]">
          {t("snippetsPage.modal.createTitle")}
        </h3>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="create-snippet-title-input" className="block text-xs text-[var(--text-muted)]">
              {t("snippetsPage.modal.field.title")}
            </label>
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
            <label htmlFor="create-snippet-language-input" className="block text-xs text-[var(--text-muted)]">
              {t("snippetsPage.modal.field.language")}
            </label>
            <input
              id="create-snippet-language-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder={t("snippetsPage.modal.field.languageHint")}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-description-input" className="block text-xs text-[var(--text-muted)]">
              {t("snippetsPage.modal.field.description")}
            </label>
            <input
              id="create-snippet-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("snippetsPage.modal.field.descriptionHint")}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-tags-input" className="block text-xs text-[var(--text-muted)]">
              {t("snippetsPage.modal.field.tags")}
            </label>
            <input
              id="create-snippet-tags-input"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t("snippetsPage.modal.field.tagsHint")}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label htmlFor="create-snippet-content-input" className="block text-xs text-[var(--text-muted)]">
              {t("snippetsPage.modal.field.content")}
            </label>
            <textarea
              id="create-snippet-content-input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="rounded-lg border-[var(--border)]"
            />
            {t("snippetsPage.modal.field.private")}
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface)]/10"
          >
            {t("snippetsPage.modal.action.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !title.trim() || !content.trim()}
            className="min-h-11 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? t("snippetsPage.modal.action.creating") : t("snippetsPage.modal.action.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
