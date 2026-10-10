"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SnippetEditModal } from "./snippet-edit-modal";
import { CreateSnippetModal } from "./create-snippet-modal";
import { Pencil, Trash2, Copy, Check, Search, Plus } from "@/components/icons";
import { EmptyState, Toolbar, ListPanel } from "@/components/page-shell";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { UI_INPUT } from "@/lib/ui/classes";
import { PaginatedList } from "@/components/paginated-list";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { Badge } from "@/components/ui-primitives";

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
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="ui-title-group break-words">{s.title}</h3>
          <Badge>{s.language}</Badge>
          {s.isPrivate && <span className="text-xs text-[var(--warning)]">{t("snippetsPage.private")}</span>}
          {s.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {s.tags.map((tag) => (
                <Badge tone="accent" key={tag}>{tag}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <ActionButton type="button" variant="ghost" onClick={() => onCopy(s)} title={t("snippetsPage.action.copy")} aria-label={t("snippetsPage.action.copy")} square>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={() => onEdit(s)} title={t("snippetsPage.action.edit")} aria-label={t("snippetsPage.action.edit")} square>
            <Pencil size={14} />
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={() => onDelete(s)} title={t("snippetsPage.action.delete")} aria-label={`${t("snippetsPage.deleteDialog.title")} ${s.title}`} square className="text-[var(--danger)]">
            <Trash2 size={14} />
          </ActionButton>
        </div>
      </div>
      {s.description && <p className="mt-1 text-xs text-[var(--text-muted)]">{s.description}</p>}
      <pre data-inset="" className="mt-3 max-h-48 overflow-auto p-3 font-mono text-xs text-[var(--text-secondary)]">{s.content ?? s.contentPreview ?? ""}</pre>
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
        <div className="min-w-0 flex-1">
          <label
            htmlFor="snippets-search"
            className="ui-label mb-1 block"
          >
            {t("snippetsPage.search")}
          </label>
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="snippets-search"
              type="search"
              value={search}
              onChange={(e) => setFilter("q", e.target.value)}
              placeholder={t("snippetsPage.titlePlaceholder")}
              className={`${UI_INPUT} pl-9 pr-4`}
            />
          </div>
        </div>
        <select

          value={langFilter}
          onChange={(e) => setFilter("lang", e.target.value)}
          aria-label={t("snippetsPage.filter.placeholder")}
          className={`${UI_INPUT} sm:w-44`}
        >
          {languages.map((l) => (
            <option key={l} value={l}>{l ==="ALL" ? t("snippetsPage.filter.allLanguages") : l}</option>
          ))}
        </select>
        <span className="px-1 text-xs text-[var(--text-muted)]">{t("snippetsPage.count", { count: filtered.length })}</span>
        <ActionButton variant="primary"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5"
        >
          <Plus size={14} /> {t("snippetsPage.new")}
        </ActionButton>
      </Toolbar>

      <ListPanel
        title={t("snippetsPage.pageTitle")}
        count={filtered.length}
        empty={
          filtered.length === 0 ? (
            <EmptyState>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("snippetsPage.deleteDialog.title")}
        description={pendingDelete ? t("snippetsPage.deleteDialog.body", { title: pendingDelete.title }) : ""}
        cancelLabel={t("snippetsPage.deleteDialog.cancel")}
        confirmLabel={deleteBusy ? t("snippetsPage.deleteDialog.deleting") : t("snippetsPage.deleteDialog.confirm")}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={handleDelete}
      />
    </>
  );
}
