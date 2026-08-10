"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { ModalShell } from "@/components/modal-shell";
import { SnippetEditModal } from "./snippet-edit-modal";
import { CreateSnippetModal } from "./create-snippet-modal";
import { Pencil, Trash2, Copy, Check, Search, Plus } from "@/components/icons";
import { EmptyState, Toolbar, ListPanel } from "@/components/page-shell";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { PaginatedList } from "@/components/paginated-list";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";

interface Snippet {
  id: string;
  title: string;
  content?: string;
  contentPreview?: string;
  contentLength?: number;
  language: string;
  description: string | null;
  tags: string[];
  isPrivate: boolean;
}

type FullSnippet = Snippet & { content: string };

type SnippetCardProps = {
  snippet: Snippet;
  t: (k: string, vars?: Record<string, string | number>) => string;
  copied: boolean;
  onCopy: (snippet: Snippet) => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
};

const SnippetCard = memo(function SnippetCard({ snippet: s, t, copied, onCopy, onEdit, onDelete }: SnippetCardProps) {
  return (
    <div data-card className="group p-4 transition hover:bg-[var(--surface-elevated)]">
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
          <ActionButton type="button" variant="ghost" onClick={() => onCopy(s)} title={t("snippetsPage.action.copy")} aria-label={t("snippetsPage.action.copy")} className="!min-h-11 !min-w-11 !rounded-lg !p-1.5">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={() => onEdit(s)} title={t("snippetsPage.action.edit")} aria-label={t("snippetsPage.action.edit")} className="!min-h-11 !min-w-11 !rounded-lg !p-1.5">
            <Pencil size={14} />
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={() => onDelete(s)} title={t("snippetsPage.action.delete")} aria-label={`${t("snippetsPage.deleteDialog.title")} ${s.title}`} className="!min-h-11 !min-w-11 !rounded-lg !p-1.5 text-[var(--danger)]">
            <Trash2 size={14} />
          </ActionButton>
        </div>
      </div>
      {s.description && <p className="mt-1 text-xs text-[var(--text-muted)]">{s.description}</p>}
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--text-secondary)]">{s.content ?? s.contentPreview ?? ""}</pre>
    </div>
  );
}, (prev, next) => prev.snippet === next.snippet && prev.t === next.t && prev.copied === next.copied && prev.onCopy === next.onCopy && prev.onEdit === next.onEdit && prev.onDelete === next.onDelete);

export function SnippetList({ snippets: initial }: { snippets: Snippet[] }) {
  const { t } = useI18n();

  const { addToast } = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<FullSnippet | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state: filters, setField: setFilter } = useUrlQueryState({ q: "", lang: "ALL" });
  const search = filters.q;
  const langFilter = filters.lang;

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const languages = useMemo(() => {
    const langs = new Set(items.map((s) => s.language));
    return ["ALL", ...Array.from(langs).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((s) => {
      if (langFilter !=="ALL" && s.language !== langFilter) return false;
      const searchableContent = (s.content ?? s.contentPreview ?? "").toLowerCase();
      if (q && !s.title.toLowerCase().includes(q) && !searchableContent.includes(q) && !s.description?.toLowerCase().includes(q) && !s.tags.some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, search, langFilter]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/snippets?id=${encodeURIComponent(pendingDelete.id)}`, { method:"DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
      addToast("success", t("snippetsPage.toast.deleted"));
    } catch (error) {
      setDeleteError(getErrorMessage(error, t("snippetsPage.toast.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  const fetchFullSnippet = useCallback(async (snippet: Snippet): Promise<FullSnippet> => {
    if (snippet.content !== undefined) return snippet as FullSnippet;
    const data = await csrfFetch<{ snippet: FullSnippet }>(`/api/snippets?id=${encodeURIComponent(snippet.id)}`);
    setItems((prev) => prev.map((s) => (s.id === snippet.id ? { ...s, ...data.snippet } : s)));
    return { ...snippet, ...data.snippet };
  }, []);

  const handleCopy = useCallback(async (snippet: Snippet) => {
    try {
      const full = await fetchFullSnippet(snippet);
      await navigator.clipboard.writeText(full.content ?? "");
      setCopiedId(full.id);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedId(null);
      }, 2000);
    } catch {
      // Clipboard write failed (permissions, non-secure context) — notify the user.
      addToast("error", t("snippetsPage.toast.copyFailed"));
    }
  }, [fetchFullSnippet, t, addToast]);

  const handleEdit = useCallback((snippet: Snippet) => {
    void fetchFullSnippet(snippet)
      .then((full) => {
        if (!full.content) {
          addToast("error", t("snippetsPage.toast.loadFailed"));
          return;
        }
        setEditing(full);
      })
      .catch(() => addToast("error", t("snippetsPage.toast.loadFailed")));
  }, [fetchFullSnippet, addToast, t]);
  const handleDeleteClick = useCallback((snippet: Snippet) => { setPendingDelete(snippet); setDeleteError(null); }, []);

  const handleSaved = (updated: Snippet) => {
    setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <>
      <Toolbar className="mb-4 flex-col items-stretch gap-3 sm:flex-row sm:items-end">
        <div className="relative min-w-0 flex-1">
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
            onChange={(e) => setFilter("q", e.target.value)}
            placeholder={t("snippetsPage.titlePlaceholder")}
            className={`${UI_INPUT} py-2 pl-9 pr-4`}
          />
        </div>
        <select

          value={langFilter}
          onChange={(e) => setFilter("lang", e.target.value)}
          aria-label={t("snippetsPage.filter.placeholder")}
          className={`${UI_INPUT} w-auto py-2`}
        >
          {languages.map((l) => (
            <option key={l} value={l}>{l ==="ALL" ? t("snippetsPage.filter.allLanguages") : l}</option>
          ))}
        </select>
        <span className="px-1 text-xs text-[var(--text-muted)]">{t("snippetsPage.count", { count: filtered.length })}</span>
        <ActionButton variant="primary"
          onClick={() => setCreating(true)}
          data-primary className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 text-sm"
        >
          <Plus size={14} /> {t("snippetsPage.new")}
        </ActionButton>
      </Toolbar>

      <ListPanel
        title={t("snippetsPage.pageTitle")}
        count={filtered.length}
        empty={
          filtered.length === 0 ? (
            <EmptyState variant="boxed">
              {items.length === 0 ? t("snippetsPage.empty") : t("snippetsPage.noMatch")}
            </EmptyState>
          ) : undefined
        }
        bodyClassName="!divide-y-0 space-y-0 bg-transparent p-2.5"
      >
        <PaginatedList pageSize={20} resetKey={`${search}\u0000${langFilter}`}>
          {filtered.map((s) => (
            <div key={s.id} className="mb-2.5 last:mb-0">
              <SnippetCard snippet={s} t={t} copied={copiedId === s.id} onCopy={handleCopy} onEdit={handleEdit} onDelete={handleDeleteClick} />
            </div>
          ))}
        </PaginatedList>
      </ListPanel>

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
        <ModalShell
          open
          onClose={() => setPendingDelete(null)}
          labelledBy="delete-snippet-title"
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
          panelClassName="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30"
        >
            <h3 id="delete-snippet-title" className="text-base font-semibold text-[var(--text-primary)]">{t("snippetsPage.deleteDialog.title")}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              {t("snippetsPage.deleteDialog.body", { title: pendingDelete.title })}
            </p>
            {deleteError && <Notice tone="danger" compact className="mt-3">{deleteError}</Notice>}
            <div className="mt-5 flex justify-end gap-2">
              <ActionButton variant="secondary" disabled={deleteBusy} onClick={() => { setPendingDelete(null); setDeleteError(null); }} className="min-h-11 !px-4 !py-2 !text-sm disabled:opacity-50">
                {t("snippetsPage.deleteDialog.cancel")}
              </ActionButton>
              <ActionButton variant="danger" disabled={deleteBusy} onClick={handleDelete} data-tone="rose" className="min-h-11 disabled:opacity-50">
                {deleteBusy ? t("snippetsPage.deleteDialog.deleting") : t("snippetsPage.deleteDialog.confirm")}
              </ActionButton>
            </div>
        </ModalShell>
      )}
    </>
  );
}
