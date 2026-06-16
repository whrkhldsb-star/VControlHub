"use client";

import { useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { SnippetEditModal } from "./snippet-edit-modal";
import { CreateSnippetModal } from "./create-snippet-modal";
import { Pencil, Trash2, Copy, Check, Search, Plus } from "lucide-react";

interface Snippet {
  id: string;
  title: string;
  content: string;
  language: string;
  description: string | null;
  tags: string[];
  isPrivate: boolean;
}

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

  // Extract unique languages
  const languages = useMemo(() => {
    const langs = new Set(items.map((s) => s.language));
    return ["ALL", ...Array.from(langs).sort()];
  }, [items]);

  // Filter items
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

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      addToast("error", t("snippetsPage.toast.copyFailed"));
    }
  };

  const handleSaved = (updated: Snippet) => {
    setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  return (
    <>
      {/* Search and filter bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label
            htmlFor="snippets-search"
            className="mb-1 block text-xs font-medium text-slate-400"
          >
            {t("snippetsPage.search")}
          </label>
          <Search size={14} className="absolute left-3 top-[2.15rem] text-slate-500" />
          <input
            id="snippets-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("snippetsPage.titlePlaceholder")}
            className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] pl-9 pr-4 py-2 text-sm text-white outline-none placeholder:text-slate-600 light:placeholder:text-slate-500"
          />
        </div>
        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          aria-label={t("snippetsPage.filter.placeholder")}
          className="rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
        >
          {languages.map((l) => (
            <option key={l} value={l}>{l === "ALL" ? t("snippetsPage.filter.allLanguages") : l}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{t("snippetsPage.count").replace("{count}", String(filtered.length))}</span>
        <button
          onClick={() => setCreating(true)}
          className="min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
        >
          <Plus size={14} /> {t("snippetsPage.new")}
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <div key={s.id} data-card className="group  p-4 transition hover:border-white/[0.12] light:hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <b className="text-sm text-white">{s.title}</b>
                <span className="rounded-full border border-white/[0.06] bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-400">{s.language}</span>
                {s.isPrivate && <span className="text-[10px] text-amber-400">{t("snippetsPage.private")}</span>}
                {s.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button onClick={() => handleCopy(s.content, s.id)} title={t("snippetsPage.action.copy")} className="min-h-11 min-w-11 rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400 light:hover:bg-slate-100">
                  {copiedId === s.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button onClick={() => setEditing(s)} title={t("snippetsPage.action.edit")} className="min-h-11 min-w-11 rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-cyan-400 light:hover:bg-slate-100">
                  <Pencil size={14} />
                </button>
                <button onClick={() => { setPendingDelete(s); setDeleteError(null); }} title={t("snippetsPage.action.delete")} aria-label={t("snippetsPage.deleteDialog.title") + " " + s.title} className="min-h-11 min-w-11 rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400 light:hover:bg-slate-100">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {s.description && <p className="mt-1 text-xs text-slate-500">{s.description}</p>}
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{s.content}</pre>
          </div>
        ))}
        {filtered.length === 0 && (
          <div data-card className=" p-8 text-center text-sm text-slate-500">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-snippet-title" className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-slate-950 p-5 shadow-2xl shadow-black/30">
            <h3 id="delete-snippet-title" className="text-base font-semibold text-white">{t("snippetsPage.deleteDialog.title")}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {t("snippetsPage.deleteDialog.body").replace("{title}", pendingDelete.title)}
            </p>
            {deleteError && <p role="alert" className="mt-3 text-xs text-rose-300">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={deleteBusy} onClick={() => { setPendingDelete(null); setDeleteError(null); }} data-card className="min-h-11 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50">
                {t("snippetsPage.deleteDialog.cancel")}
              </button>
              <button type="button" disabled={deleteBusy} onClick={handleDelete} data-tone="rose" className="min-h-11 rounded-xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-50">
                {deleteBusy ? t("snippetsPage.deleteDialog.deleting") : t("snippetsPage.deleteDialog.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
