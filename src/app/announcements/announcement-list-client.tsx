"use client";

import { useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { AnnouncementEditModal } from "./announcement-edit-modal";
import { Pencil, Trash2, Search } from "@/components/icons";

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
  info: "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.04]",
  warning: "border-amber-400/20 bg-amber-400/[0.04]",
  urgent: "border-rose-400/20 bg-rose-400/[0.04]",
};

function levelLabel(t: (k: string) => string, key: string): string {
  return t(`announcementsPage.level.${key}`) !== `announcementsPage.level.${key}` ? t(`announcementsPage.level.${key}`) : key;
}

export function AnnouncementList({
  items: initial,
  canManage,
}: {
  items: Announcement[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { addToast } = useToast();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");

  const levels = useMemo(() => {
    const lvs = new Set(items.map((a) => a.level));
    return ["ALL", ...Array.from(lvs).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items
      .filter((a) => {
        if (levelFilter !== "ALL" && a.level !== levelFilter) return false;
        if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
      });
  }, [items, search, levelFilter]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await csrfFetch(`/api/announcements?id=${pendingDelete.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      setPendingDelete(null);
      addToast("success", t("announcementsPage.toast.deleted"));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("announcementsPage.toast.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleSaved = (updated: Announcement) => {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return (
    <>
      {/* Search and filter bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label
            htmlFor="announcements-search"
            className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
          >
            {t("announcementsPage.search.label")}
          </label>
          <Search size={14} className="absolute left-3 top-[2.35rem] text-[var(--text-muted)]" />
          <input
            id="announcements-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("announcementsPage.search.placeholder")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] pl-9 pr-4 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label={t("announcementsPage.filter.label")}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
        >
          {levels.map((l) => (
            <option key={l} value={l}>{l === "ALL" ? t("announcementsPage.filter.all") : levelLabel(t, l)}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--text-muted)]">{t("announcementsPage.count").replace("{count}", String(filtered.length))}</span>
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <div data-card className=" p-8 text-center text-sm text-[var(--text-muted)]">
            {items.length === 0 ? t("announcementsPage.empty") : t("announcementsPage.emptyFiltered")}
          </div>
        ) : (
          filtered.map((a) => (
            <div key={a.id} className={`group relative rounded-xl border p-5 ${levelColors[a.level] ?? levelColors.info}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {a.pinned && <span className="text-xs text-amber-400">{t("common.pinned")}</span>}
                    <span className="text-xs text-[var(--text-muted)]">{levelLabel(t, a.level)}</span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{a.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{new Date(a.startsAt).toLocaleDateString("en-US")}</span>
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(a)} title={t("announcementsPage.action.edit")} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface)]/10 hover:text-[var(--color-action)]">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { setPendingDelete(a); setDeleteError(null); }} title={t("announcementsPage.action.delete")} aria-label={t("announcementsPage.action.deleteAria").replace("{title}", a.title)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface)]/10 hover:text-rose-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{a.body}</p>
              {a.expiresAt && (
                <p className="mt-3 text-xs text-[var(--text-muted)]">{t("common.validUntil")} {new Date(a.expiresAt).toLocaleString("en-US")}</p>
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

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-announcement-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
            <h3 id="delete-announcement-title" className="text-base font-semibold text-[var(--text-primary)]">{t("announcementsPage.delete.title")}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("announcementsPage.delete.confirm").replace("{title}", pendingDelete.title)}</p>
            {deleteError && <p role="alert" className="mt-3 text-xs text-rose-400 dark:text-rose-300">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={deleteBusy} onClick={() => { setPendingDelete(null); setDeleteError(null); }} data-card className=" px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50">
                {t("announcementsPage.delete.cancel")}
              </button>
              <button type="button" disabled={deleteBusy} onClick={handleDelete} data-tone="rose" className="rounded-xl border border-rose-400/30 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-50">
                {deleteBusy ? t("announcementsPage.delete.deleting") : t("announcementsPage.delete.confirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
