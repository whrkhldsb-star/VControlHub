"use client";

import { memo, useCallback, useState, useMemo } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDate, formatDateTime } from "@/lib/datetime/format";
import { AnnouncementEditModal } from "./announcement-edit-modal";
import { Pencil, Trash2, Search } from "@/components/icons";
import { getErrorMessage } from "@/lib/http/error-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge, IconButton } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { PaginatedList } from "@/components/paginated-list";
import { EmptyState } from "@/components/page-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  startsAt: string;
  expiresAt: string | null;
}

const levelTones: Record<string, StatusTone> = {
  info: "info",
  warning: "warning",
  urgent: "danger",
};

function levelLabel(t: (k: string, vars?: Record<string, string | number>) => string, key: string): string {
  return t(`announcementsPage.level.${key}`) !== `announcementsPage.level.${key}` ? t(`announcementsPage.level.${key}`) : key;
}

type AnnouncementCardProps = {
  announcement: Announcement;
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: string;
  canManage: boolean;
  onEdit: (a: Announcement) => void;
  onDelete: (a: Announcement) => void;
};

const AnnouncementCard = memo(function AnnouncementCard({ announcement: a, t, locale, canManage, onEdit, onDelete }: AnnouncementCardProps) {
  return (
    <div data-card className="group relative p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={levelTones[a.level] ?? "info"}>{levelLabel(t, a.level)}</StatusBadge>
            {a.pinned && <Badge tone="accent">{t("common.pinned")}</Badge>}
          </div>
          <h2 className="ui-title-section mt-2">{a.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDate(a.startsAt, locale as"zh" |"en")}</span>
          {canManage && (
            <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <IconButton label={t("announcementsPage.action.edit")} tone="accent" onClick={() => onEdit(a)} className="h-11 w-11">
                <Pencil size={14} />
              </IconButton>
              <IconButton label={t("announcementsPage.action.deleteAria", { title: a.title })} tone="danger" onClick={() => onDelete(a)} className="h-11 w-11">
                <Trash2 size={14} />
              </IconButton>
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{a.body}</p>
      {a.expiresAt && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">{t("common.validUntil")} {formatDateTime(a.expiresAt, locale as"zh" |"en")}</p>
      )}
    </div>
  );
}, (prev, next) => prev.announcement === next.announcement && prev.t === next.t && prev.locale === next.locale && prev.canManage === next.canManage && prev.onEdit === next.onEdit && prev.onDelete === next.onDelete);

export function AnnouncementList({
  items: initial,
  canManage,
}: {
  items: Announcement[];
  canManage: boolean;
}) {
  const { t, locale } = useI18n();
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
        if (levelFilter !=="ALL" && a.level !== levelFilter) return false;
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
      await csrfFetch(`/api/announcements?id=${encodeURIComponent(pendingDelete.id)}`, { method:"DELETE" });
      setItems((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      setPendingDelete(null);
      addToast("success", t("announcementsPage.toast.deleted"));
    } catch (error) {
      setDeleteError(getErrorMessage(error, t("announcementsPage.toast.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleEdit = useCallback((a: Announcement) => setEditing(a), []);
  const handleDeleteClick = useCallback((a: Announcement) => { setPendingDelete(a); setDeleteError(null); }, []);

  const handleSaved = (updated: Announcement) => {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label
            htmlFor="announcements-search"
            className="ui-label mb-1 block"
          >
            {t("announcementsPage.search.label")}
          </label>
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              id="announcements-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("announcementsPage.search.placeholder")}
              className={cn(UI_INPUT, "pl-9 pr-4")}
            />
          </div>
        </div>
        <div className="sm:w-44 sm:self-end">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            aria-label={t("announcementsPage.filter.label")}
            className={UI_INPUT}
          >
            {levels.map((l) => (
              <option key={l} value={l}>{l ==="ALL" ? t("announcementsPage.filter.all") : levelLabel(t, l)}</option>
            ))}
          </select>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-muted)] sm:self-end sm:pb-2.5">{t("announcementsPage.count", { count: filtered.length })}</span>
      </div>

      <div>
        {filtered.length === 0 ? (
          <EmptyState
            variant="boxed"
            text={items.length === 0 ? t("announcementsPage.empty") : t("announcementsPage.emptyFiltered")}
          />
        ) : (
          <PaginatedList pageSize={20} resetKey={`${search}\u0000${levelFilter}`} className="grid gap-4">
            {filtered.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} t={t} locale={locale} canManage={canManage} onEdit={handleEdit} onDelete={handleDeleteClick} />
            ))}
          </PaginatedList>
        )}
      </div>

      {editing && (
        <AnnouncementEditModal
          announcement={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("announcementsPage.delete.title")}
        description={pendingDelete ? t("announcementsPage.delete.confirm", { title: pendingDelete.title }) : ""}
        cancelLabel={t("announcementsPage.delete.cancel")}
        confirmLabel={deleteBusy ? t("announcementsPage.delete.deleting") : t("announcementsPage.delete.confirmBtn")}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={handleDelete}
        closeOnBackdrop={false}
      />
    </>
  );
}
