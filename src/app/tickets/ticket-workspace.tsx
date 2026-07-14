"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { t, type Locale } from "@/lib/i18n/translations";

export type TicketWorkspaceTicket = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { username: string; displayName: string | null } | null;
  assignee: { username: string; displayName: string | null } | null;
};

type Props = {
  initialTickets: TicketWorkspaceTicket[];
  canManage: boolean;
  locale: Locale;
  now: string;
};

type SlaStatus = "ok" | "warning" | "breached" | "none";
type ViewMode = "list" | "board";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CATEGORIES = ["incident", "request", "question", "feedback"] as const;
const SLA_STATUSES: SlaStatus[] = ["ok", "warning", "breached", "none"];

const statusTone: Record<string, string> = {
  OPEN: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
  IN_PROGRESS: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  RESOLVED: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  CLOSED: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
};

const priorityTone: Record<string, string> = {
  LOW: "text-[var(--text-muted)]",
  NORMAL: "text-[var(--text-secondary)]",
  HIGH: "text-[var(--warning)]",
  URGENT: "text-[var(--danger)]",
};

const slaTone: Record<SlaStatus, string> = {
  ok: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  breached: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
  none: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]",
};

function getSlaStatus(ticket: TicketWorkspaceTicket, nowMs: number): SlaStatus {
  if (!ticket.slaDueAt || ticket.status === "CLOSED" || ticket.status === "RESOLVED") return "none";
  const remaining = new Date(ticket.slaDueAt).getTime() - nowMs;
  if (remaining < 0) return "breached";
  if (remaining < 60 * 60 * 1000) return "warning";
  return "ok";
}

function label(locale: Locale, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  const translated = t(key, locale);
  return translated === key ? value.replaceAll("_", " ") : translated;
}

function TicketCard({ ticket, locale, nowMs, compact = false }: { ticket: TicketWorkspaceTicket; locale: Locale; nowMs: number; compact?: boolean }) {
  const slaStatus = getSlaStatus(ticket, nowMs);
  const dateLocale = toDateLocale(locale);
  return (
    <Link href={`/tickets/${ticket.id}`} className={`block transition hover:bg-[var(--surface-hover)] ${compact ? "rounded-xl border border-[var(--border)] p-3" : "px-5 py-4"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{ticket.title}</h3>
            <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${priorityTone[ticket.priority] ?? "text-[var(--text-muted)]"}`}>
              {label(locale, "ticketsPage.priority", ticket.priority)}
            </span>
            {ticket.category && (
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                {label(locale, "ticketsPage.category", ticket.category)}
              </span>
            )}
          </div>
          {!compact && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{ticket.description}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className={`rounded-full border px-2 py-0.5 font-medium ${slaTone[slaStatus]}`}>
              {t(`ticketsPage.sla.${slaStatus}`, locale)}
            </span>
            {ticket.slaDueAt && (
              <span>{t("ticketsPage.sla.due", locale).replace("{time}", new Date(ticket.slaDueAt).toLocaleString(dateLocale))}</span>
            )}
            {!compact && ticket.creator && (
              <span>{t("ticketsPage.creator", locale).replace("{name}", ticket.creator.displayName || ticket.creator.username)}</span>
            )}
            {!compact && ticket.assignee && (
              <span>{t("ticketsPage.assignee", locale).replace("{name}", ticket.assignee.displayName || ticket.assignee.username)}</span>
            )}
            {!compact && <span>{t("ticketsPage.createdAt", locale).replace("{time}", new Date(ticket.createdAt).toLocaleString(dateLocale))}</span>}
          </div>
        </div>
        {!compact && (
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone[ticket.status] ?? "border-[var(--border)] text-[var(--text-muted)]"}`}>
            {label(locale, "ticketsPage.status", ticket.status)}
          </span>
        )}
      </div>
    </Link>
  );
}

export function TicketWorkspace({ initialTickets, canManage, locale, now }: Props) {
  const [view, setView] = useState<ViewMode>("list");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [slaStatus, setSlaStatus] = useState("");
  const [search, setSearch] = useState("");
  const nowMs = useMemo(() => new Date(now).getTime(), [now]);

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US");
    return initialTickets.filter((ticket) => {
      if (status && ticket.status !== status) return false;
      if (priority && ticket.priority !== priority) return false;
      if (category && ticket.category !== category) return false;
      if (slaStatus && getSlaStatus(ticket, nowMs) !== slaStatus) return false;
      if (query && !`${ticket.title}\n${ticket.description}`.toLocaleLowerCase(locale === "zh" ? "zh-CN" : "en-US").includes(query)) return false;
      return true;
    });
  }, [category, initialTickets, locale, nowMs, priority, search, slaStatus, status]);

  const clearFilters = () => {
    setStatus("");
    setPriority("");
    setCategory("");
    setSlaStatus("");
    setSearch("");
  };

  return (
    <section data-card className="overflow-hidden !p-0">
      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {t("ticketsPage.listHeader", locale).replace("{count}", String(filteredTickets.length))}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {canManage ? t("ticketsPage.workspace.manageHint", locale) : t("ticketsPage.workspace.personalHint", locale)}
            </p>
          </div>
          <div className="inline-flex w-fit rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1">
            {(["list", "board"] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setView(mode)} aria-pressed={view === mode} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === mode ? "bg-[var(--accent)] text-white" : "text-[var(--text-secondary)]"}`}>
                {t(mode === "list" ? "ticketsPage.kanban.list" : "ticketsPage.kanban.toggle", locale)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
            {t("ticketsPage.filter.search", locale)}
            <input aria-label={t("ticketsPage.filter.search", locale)} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ticketsPage.filter.search", locale)} className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)]" />
          </label>
          <FilterSelect labelText={t("ticketsPage.filter.status", locale)} value={status} onChange={setStatus} allLabel={t("ticketsPage.filter.all", locale)} options={STATUSES.map((value) => ({ value, label: label(locale, "ticketsPage.status", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.priority", locale)} value={priority} onChange={setPriority} allLabel={t("ticketsPage.filter.all", locale)} options={PRIORITIES.map((value) => ({ value, label: label(locale, "ticketsPage.priority", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.category", locale)} value={category} onChange={setCategory} allLabel={t("ticketsPage.filter.all", locale)} options={CATEGORIES.map((value) => ({ value, label: label(locale, "ticketsPage.category", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.slaStatus", locale)} value={slaStatus} onChange={setSlaStatus} allLabel={t("ticketsPage.filter.all", locale)} options={SLA_STATUSES.map((value) => ({ value, label: t(`ticketsPage.sla.${value}`, locale) }))} />
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
            {t("ticketsPage.filter.clear", locale)}
          </button>
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-[var(--text-muted)]">{t("ticketsPage.emptyFiltered", locale)}</div>
      ) : view === "list" ? (
        <div className="divide-y divide-[var(--border-subtle)]">{filteredTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} locale={locale} nowMs={nowMs} />)}</div>
      ) : (
        <div className="grid gap-4 overflow-x-auto p-4 lg:grid-cols-4">
          {STATUSES.map((columnStatus) => {
            const columnTickets = filteredTickets.filter((ticket) => ticket.status === columnStatus);
            return (
              <div key={columnStatus} data-testid={`ticket-column-${columnStatus}`} className="min-w-64 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]">
                  <span>{label(locale, "ticketsPage.status", columnStatus)}</span><span>{columnTickets.length}</span>
                </div>
                <div className="space-y-3">{columnTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} locale={locale} nowMs={nowMs} compact />)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FilterSelect({ labelText, value, onChange, allLabel, options }: { labelText: string; value: string; onChange: (value: string) => void; allLabel: string; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
      {labelText}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--text-primary)]">
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
