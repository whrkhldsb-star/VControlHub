"use client";

import { memo, useCallback, useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { SnippetEditModal } from "./snippet-edit-modal";
import { CreateSnippetModal } from "./create-snippet-modal";
import { Pencil, Trash2, Copy, Check, Search, Plus } from "@/components/icons";

interface Snippet {
  id: string;
  title: string;
  content: string;
  language: string;
  description: string | null;
  tags: string[];
  isPrivate: boolean;
}

type SnippetCardProps = {
  snippet: Snippet;
  t: (k: string) => string;
  copied: boolean;
  onCopy: (content: string, id: string) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
};

const SnippetCard = memo(function SnippetCard({ snippet: s, t, copied, onCopy, onEdit, onDelete }: SnippetCardProps) {
  return (
    <div data-card className="group  p-4 transition hover:border-[var(--border)]/[0.12]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <b className="text-sm text-[var(--text-primary)]">{s.title}</b>
          <span className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{s.language}</span>
          {s.isPrivate && <span className="text-[10px] text-[var(--warning)]">{t("snippetsPage.private")}</span>}
          {s.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {s.tags.map((tag) => (
                <span key={tag} data-tone="cyan" className="rounded-lg border border-[var(--accent-border)] px-2 py-0.5 text-[10px] text-[var(--accent)]">{tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button onClick={() => onCopy(s.content, s.id)} title={t("snippetsPage.action.copy")} aria-label={t("snippetsPage.action.copy")} className="min-h-11 min-w-11 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface)]/10 hover:text-[var(--color-action)]">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button onClick={() => onEdit(s)} title={t("snippetsPage.action.edit")} aria-label={t("snippetsPage.action.edit")} className="min-h-11 min-w-11 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface)]/10 hover:text-[var(--color-action)]">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(s)} title={t("snippetsPage.action.delete")} aria-label={t("snippetsPage.deleteDialog.title") + " " + s.title} className="min-h-11 min-w-11 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface)]/10 hover:text-[var(--danger)]">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {s.description && <p className="mt-1 text-xs text-[var(--text-muted)]">{s.description}</p>}
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--text-secondary)]">{s.content}</pre>
    </div>
  );
}, (prev, next) => prev.snippet === next.snippet && prev.t === next.t && prev.copied === next.copied && prev.onCopy === next.onCopy && prev.onEdit === next.onEdit && prev.onDelete === next.onDelete);

export function SnippetList({ snippets: initial }: { snippets: Snippet[] }) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("ALL");

  const languages = useMemo(() => {
    const langs = new Set(items.map((s) => s.language));
    return ["ALL", ...Array.from(langs).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((s) => {
      if (langFilter !== "ALL" && s.language !== langFilter) return false;
      if (q && !s.title.toLowerCase().includes(q) && !s.content.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q) && !s.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, search, langFilter]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/snippets?id=${encodeURIComponent(pendingDelete.id)}`, { method: "DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
      addToast("success", t("snippetsPage.toast.deleted"));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("snippetsPage.toast.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleCopy = useCallback(async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      addToast("error", t("snippetsPage.toast.copyFailed"));
    }
  }, [t, addToast]);

  const handleEdit = useCallback((snippet: Snippet) => setEditing(snippet), []);
  const handleDeleteClick = useCallback((snippet: Snippet) => { setPendingDelete(snippet); setDeleteError(null); }, []);

  const handleSaved = (updated: Snippet) => {
    setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label
            htmlFor="snippets-search"
            className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
          >
            {t("snippetsPage.search")}
          </label>
          <Search size={14} className="absolute left-3 top-[2.15rem] text-[var(--text-muted)]" />
          <input
            id="snippets-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("snippetsPage.titlePlaceholder")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] pl-9 pr-4 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          aria-label={t("snippetsPage.filter.placeholder")}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
        >
          {languages.map((l) => (
            <option key={l} value={l}>{l === "ALL" ? t("snippetsPage.filter.allLanguages") : l}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--text-muted)]">{t("snippetsPage.count").replace("{count}", String(filtered.length))}</span>
        <button
          onClick={() => setCreating(true)}
          className="min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-action-strong)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action)]"
        >
          <Plus size={14} /> {t("snippetsPage.new")}
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <SnippetCard key={s.id} snippet={s} t={t} copied={copiedId === s.id} onCopy={handleCopy} onEdit={handleEdit} onDelete={handleDeleteClick} />
        ))}
        {filtered.length === 0 && (
          <div data-card className=" p-8 text-center text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t("snippetsPage.empty") : t("snippetsPage.noMatch")}
          </div>
        )}
      </div>

      {creating && (
        <CreateSnippetModal
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setItems((prev) => [created, ...prev]);
            addToast("success", t("snippetsPage.toast.created"));
          }}
        />
      )}

      {editing && (
        <SnippetEditModal
          snippet={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-snippet-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
            <h3 id="delete-snippet-title" className="text-base font-semibold text-[var(--text-primary)]">{t("snippetsPage.deleteDialog.title")}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              {t("snippetsPage.deleteDialog.body").replace("{title}", pendingDelete.title)}
            </p>
            {deleteError && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={deleteBusy} onClick={() => { setPendingDelete(null); setDeleteError(null); }} data-card className="min-h-11 px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50">
                {t("snippetsPage.deleteDialog.cancel")}
              </button>
              <button type="button" disabled={deleteBusy} onClick={handleDelete} data-tone="rose" className="min-h-11 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-50">
                {deleteBusy ? t("snippetsPage.deleteDialog.deleting") : t("snippetsPage.deleteDialog.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
