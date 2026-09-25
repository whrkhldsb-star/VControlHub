"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";

import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import { UI_INPUT } from "@/lib/ui/classes";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Badge } from "@/components/ui-primitives";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/page-shell";

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
  now: string;
};

type SlaStatus = "ok" | "warning" | "breached" | "none";
type ViewMode = "list" | "board";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CATEGORIES = ["incident", "request", "question", "feedback"] as const;
const SLA_STATUSES: SlaStatus[] = ["ok", "warning", "breached", "none"];

const statusTone: Record<string, StatusTone> = {
  OPEN: "accent",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

const priorityTone: Record<string, string> = {
  LOW: "text-[var(--text-muted)]",
  NORMAL: "text-[var(--text-secondary)]",
  HIGH: "text-[var(--warning)]",
  URGENT: "text-[var(--danger)]",
};

const slaTone: Record<SlaStatus, StatusTone> = {
  ok: "success",
  warning: "warning",
  breached: "danger",
  none: "neutral",
};

function getSlaStatus(ticket: TicketWorkspaceTicket, nowMs: number): SlaStatus {
  if (!ticket.slaDueAt || ticket.status === "CLOSED" || ticket.status === "RESOLVED") return "none";
  const remaining = new Date(ticket.slaDueAt).getTime() - nowMs;
  if (remaining < 0) return "breached";
  if (remaining < 60 * 60 * 1000) return "warning";
  return "ok";
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function label(t: Translate, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  const translated = t(key);
  return translated === key ? value.replaceAll("_", "") : translated;
}

function TicketCard({ ticket, nowMs, compact = false }: { ticket: TicketWorkspaceTicket; nowMs: number; compact?: boolean }) {
  const { t, locale } = useI18n();
  const slaStatus = getSlaStatus(ticket, nowMs);
  return (
    <Link href={`/tickets/${ticket.id}`} className={`block transition hover:bg-[var(--surface-hover)] ${compact ? "rounded-xl border border-[var(--border)] p-3" : "px-5 py-4"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{ticket.title}</h3>
            <span className={`text-xs font-semibold uppercase ${priorityTone[ticket.priority] ?? "text-[var(--text-muted)]"}`}>
              {label(t, "ticketsPage.priority", ticket.priority)}
            </span>
            {ticket.category && (
              <Badge tone="neutral">{label(t, "ticketsPage.category", ticket.category)}</Badge>
            )}
          </div>
          {!compact && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{ticket.description}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <StatusBadge tone={slaTone[slaStatus]} size="sm">
              {t(`ticketsPage.sla.${slaStatus}`)}
            </StatusBadge>
            {ticket.slaDueAt && (
              <span>{t("ticketsPage.sla.due", { time: formatDateTime(ticket.slaDueAt, locale) })}</span>
            )}
            {!compact && ticket.creator && (
              <span>{t("ticketsPage.creator", { name: ticket.creator.displayName || ticket.creator.username })}</span>
            )}
            {!compact && ticket.assignee && (
              <span>{t("ticketsPage.assignee", { name: ticket.assignee.displayName || ticket.assignee.username })}</span>
            )}
            {!compact && <span>{t("ticketsPage.createdAt", { time: formatDateTime(ticket.createdAt, locale) })}</span>}
          </div>
        </div>
        {!compact && (
          <StatusBadge tone={statusTone[ticket.status] ?? "neutral"} size="md" className="shrink-0">
            {label(t, "ticketsPage.status", ticket.status)}
          </StatusBadge>
        )}
      </div>
    </Link>
  );
}

export function TicketWorkspace({ initialTickets, canManage, now }: Props) {
  const { t, locale } = useI18n();
  const { state: urlState, setField: setUrlField, patch: patchUrl } = useUrlQueryState({
    view: "list",
    status: "",
    priority: "",
    category: "",
    sla: "",
    q: "",
    page: "1",
  });
  const view = (urlState.view === "board" ? "board" : "list") as ViewMode;
  const setView = (value: ViewMode) => setUrlField("view", value);
  const status = urlState.status || "";
  const setStatus = (value: string) => patchUrl({ status: value, page: "1" });
  const priority = urlState.priority || "";
  const setPriority = (value: string) => patchUrl({ priority: value, page: "1" });
  const category = urlState.category || "";
  const setCategory = (value: string) => patchUrl({ category: value, page: "1" });
  const slaStatus = urlState.sla || "";
  const setSlaStatus = (value: string) => patchUrl({ sla: value, page: "1" });
  const search = urlState.q || "";
  const setSearch = (value: string) => patchUrl({ q: value, page: "1" });
  const page = Math.max(1, Number.parseInt(urlState.page || "1", 10) || 1);
  const setPage = (value: number) => setUrlField("page", String(Math.max(1, value)));
  const PAGE_SIZE = 30;
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
    patchUrl({ status: "", priority: "", category: "", sla: "", q: "", page: "1" });
  };

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  const pagedTickets = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredTickets.slice(start, start + PAGE_SIZE);
  }, [filteredTickets, page, totalPages]);

  return (
    <section data-card className="overflow-hidden !p-0">
      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {t("ticketsPage.listHeader", { count: filteredTickets.length })}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {canManage ? t("ticketsPage.workspace.manageHint") : t("ticketsPage.workspace.personalHint")}
            </p>
          </div>
          <div className="inline-flex w-fit rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-1">
            {(["list", "board"] as const).map((mode) => (
              <button type="button" data-action-button={view === mode ? "" : undefined} data-variant={view === mode ? "primary" : undefined} key={mode} onClick={() => setView(mode)} aria-pressed={view === mode} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === mode ? "" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
                {t(mode === "list" ? "ticketsPage.kanban.list" : "ticketsPage.kanban.toggle")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs text-[var(--text-secondary)]">
            {t("ticketsPage.filter.search")}
            <input aria-label={t("ticketsPage.filter.search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("ticketsPage.filter.search")} className={UI_INPUT} />
          </label>
          <FilterSelect labelText={t("ticketsPage.filter.status")} value={status} onChange={setStatus} allLabel={t("ticketsPage.filter.all")} options={STATUSES.map((value) => ({ value, label: label(t, "ticketsPage.status", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.priority")} value={priority} onChange={setPriority} allLabel={t("ticketsPage.filter.all")} options={PRIORITIES.map((value) => ({ value, label: label(t, "ticketsPage.priority", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.category")} value={category} onChange={setCategory} allLabel={t("ticketsPage.filter.all")} options={CATEGORIES.map((value) => ({ value, label: label(t, "ticketsPage.category", value) }))} />
          <FilterSelect labelText={t("ticketsPage.filter.slaStatus")} value={slaStatus} onChange={setSlaStatus} allLabel={t("ticketsPage.filter.all")} options={SLA_STATUSES.map((value) => ({ value, label: t(`ticketsPage.sla.${value}`) }))} />
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
            {t("ticketsPage.filter.clear")}
          </button>
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <EmptyState text={t("ticketsPage.emptyFiltered")} />
      ) : view === "list" ? (
        <>
          <div className="divide-y divide-[var(--border-subtle)]">{pagedTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} nowMs={nowMs} />)}</div>
          {filteredTickets.length > PAGE_SIZE ? (
            <Pagination page={Math.min(page, totalPages)} pageSize={PAGE_SIZE} totalItems={filteredTickets.length} onPageChange={setPage} />
          ) : null}
        </>
      ) : (
        <div className="grid gap-4 overflow-x-auto p-4 lg:grid-cols-4">
          {STATUSES.map((columnStatus) => {
            const columnTickets = filteredTickets.filter((ticket) => ticket.status === columnStatus);
            return (
              <div key={columnStatus} data-testid={`ticket-column-${columnStatus}`} className="min-w-64 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)]">
                  <span>{label(t, "ticketsPage.status", columnStatus)}</span><span>{columnTickets.length}</span>
                </div>
                <div className="space-y-3">{columnTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} nowMs={nowMs} compact />)}</div>
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
      <select value={value} onChange={(event) => onChange(event.target.value)} className={UI_INPUT}>
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
