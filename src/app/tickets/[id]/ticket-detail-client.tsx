"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";

export interface TicketUser { id: string; username: string; displayName: string | null; }
export interface TicketComment { id: string; body: string; createdAt: string; author: TicketUser; }
export interface Ticket {
  id: string; title: string; description: string; status: string; priority: string;
  createdBy: string; assigneeId: string | null; createdAt: string; updatedAt: string; closedAt: string | null;
  relatedServerId?: string | null;
  relatedCommandId?: string | null;
  creator: TicketUser; assignee: TicketUser | null; comments: TicketComment[];
}

type TimelineEvent = {
  id: string;
  at: string;
  type: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
};

type TimelineResponse = {
  events: TimelineEvent[];
  related: {
    server: { id: string; name: string; host: string } | null;
    command: { id: string; title: string; command: string; status: string; createdAt: string } | null;
    reverseTickets: Array<{ id: string; title: string; status: string }>;
  };
};

interface TicketDetailClientProps {
  initial: Ticket;
  canManage: boolean;
  users?: TicketUser[];
  locale?: string;
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
  IN_PROGRESS: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  RESOLVED: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  CLOSED: "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]",
};
const PRIORITY_TONE: Record<string, string> = {
  LOW: "text-[var(--text-secondary)]", NORMAL: "text-[var(--text-secondary)]", HIGH: "text-[var(--warning)]", URGENT: "text-[var(--danger)]",
};

function statusLabel(t: (k: string) => string, status: string): string {
  return t(`ticketsDetail.status.${status}`);
}
function priorityLabel(t: (k: string) => string, priority: string): string {
  return t(`ticketsDetail.priority.${priority}`);
}

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
};

export function TicketDetailClient({ initial, canManage, users = [] }: TicketDetailClientProps) {
  const { t, locale } = useI18n();
  const [ticket, setTicket] = useState(initial);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId ?? "");
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [commandIdInput, setCommandIdInput] = useState(initial.relatedCommandId ?? "");
  const [serverIdInput, setServerIdInput] = useState(initial.relatedServerId ?? "");

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const data = await csrfFetch<TimelineResponse>(`/api/tickets/${ticket.id}/timeline`);
      setTimeline(data);
      if (data.related.command) setCommandIdInput(data.related.command.id);
      if (data.related.server) setServerIdInput(data.related.server.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("ticketsDetail.error.timelineFailed"));
    } finally {
      setTimelineLoading(false);
    }
  }, [ticket.id, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await csrfFetch<TimelineResponse>(`/api/tickets/${ticket.id}/timeline`);
        if (!cancelled) {
          setTimeline(data);
          if (data.related.command) setCommandIdInput(data.related.command.id);
          if (data.related.server) setServerIdInput(data.related.server.id);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("ticketsDetail.error.timelineFailed"));
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.id, t]);

  const updateAssignee = async (newAssigneeId: string) => {
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ ticket: Ticket }>(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: newAssigneeId || null }),
      });
      setTicket((prev) => ({ ...prev, ...data.ticket }));
      setAssigneeId(data.ticket.assigneeId ?? "");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("ticketsDetail.error.assignFailed")); }
    finally { setSaving(false); }
  };

  const updateStatus = async (newStatus: string) => {
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ ticket: Ticket }>(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setTicket((prev) => ({ ...prev, ...data.ticket }));
      await loadTimeline();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("ticketsDetail.error.updateFailed")); }
    finally { setSaving(false); }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ comment: TicketComment }>(`/api/tickets/${ticket.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim() }),
      });
      setTicket((prev) => ({
        ...prev,
        comments: [...prev.comments, data.comment],
        updatedAt: new Date().toISOString(),
      }));
      setComment("");
      await loadTimeline();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("ticketsDetail.error.replyFailed")); }
    finally { setSaving(false); }
  };

  const runLink = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<TimelineResponse>(`/api/tickets/${ticket.id}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setTimeline(data);
      setTicket((prev) => ({
        ...prev,
        relatedCommandId: data.related.command?.id ?? null,
        relatedServerId: data.related.server?.id ?? null,
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("ticketsDetail.error.linkFailed"));
    } finally {
      setSaving(false);
    }
  };

  const eventTypeLabel = (type: string) => {
    const key = `ticketsDetail.event.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
  };

  return (
    <div className="space-y-5">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
        {t("ticketsDetail.backToList")}
      </Link>

      <div data-card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">{ticket.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_TONE[ticket.status] ?? ""}`}>
                {statusLabel(t, ticket.status)}
              </span>
              <span className={`text-xs font-semibold uppercase tracking-[0.08em] ${PRIORITY_TONE[ticket.priority] ?? ""}`}>
                {priorityLabel(t, ticket.priority)}
              </span>
            </div>
          </div>
          <div className="text-left text-xs text-[var(--text-muted)] sm:text-right">
            <p>{t("ticketsDetail.createdAt").replace("{time}", new Date(ticket.createdAt).toLocaleString(toDateLocale(locale)))}</p>
            <p>{t("ticketsDetail.updatedAt").replace("{time}", new Date(ticket.updatedAt).toLocaleString(toDateLocale(locale)))}</p>
            {ticket.closedAt && <p>{t("ticketsDetail.closedAt").replace("{time}", new Date(ticket.closedAt).toLocaleString(toDateLocale(locale)))}</p>}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{ticket.description}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          <span>{t("ticketsDetail.creator").replace("{name}", ticket.creator.displayName || ticket.creator.username)}</span>
          {ticket.assignee && <span>{t("ticketsDetail.assignee").replace("{name}", ticket.assignee.displayName || ticket.assignee.username)}</span>}
        </div>

        {canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="shrink-0 text-[var(--text-muted)]">{t("ticketsDetail.assignTo")}</span>
            <select
              value={assigneeId}
              onChange={(e) => { setAssigneeId(e.target.value); void updateAssignee(e.target.value); }}
              disabled={saving}
              aria-label={t("ticketsDetail.assignAria")}
              className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] outline-none disabled:opacity-50"
            >
              <option value="">{t("ticketsDetail.unassigned")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Related objects + link controls */}
      <div data-card className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsDetail.relatedTitle")}</h3>
        <p className="mb-3 text-xs text-[var(--text-muted)]">{t("ticketsDetail.timelineDesc")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 text-xs">
            <div className="font-medium text-[var(--text-primary)]">{t("ticketsDetail.relatedCommand")}</div>
            {timeline?.related.command ? (
              <div className="mt-1 space-y-1 text-[var(--text-secondary)]">
                <div>{timeline.related.command.title} · {timeline.related.command.status}</div>
                <code className="block break-all text-[11px] opacity-80">{timeline.related.command.command}</code>
                <Link href={`/commands?highlight=${timeline.related.command.id}`} className="text-[var(--accent)] underline-offset-2 hover:underline">
                  {t("ticketsDetail.openCommand")}
                </Link>
              </div>
            ) : (
              <div className="mt-1 text-[var(--text-muted)]">{t("ticketsDetail.relatedNone")}</div>
            )}
            {canManage && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[11px]"
                  value={commandIdInput}
                  onChange={(e) => setCommandIdInput(e.target.value)}
                  placeholder={t("ticketsDetail.commandIdPlaceholder")}
                />
                <button
                  type="button"
                  disabled={saving || !commandIdInput.trim()}
                  onClick={() => void runLink({ action: "link_command", commandRequestId: commandIdInput.trim() })}
                  className="rounded-lg border border-[var(--accent-border)] px-2 py-1 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-50"
                >
                  {t("ticketsDetail.linkCommand")}
                </button>
                <button
                  type="button"
                  disabled={saving || !timeline?.related.command}
                  onClick={() => void runLink({ action: "unlink_command" })}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {t("ticketsDetail.unlinkCommand")}
                </button>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3 text-xs">
            <div className="font-medium text-[var(--text-primary)]">{t("ticketsDetail.relatedServer")}</div>
            {timeline?.related.server ? (
              <div className="mt-1 space-y-1 text-[var(--text-secondary)]">
                <div>{timeline.related.server.name} ({timeline.related.server.host})</div>
                <Link href={`/servers?highlight=${timeline.related.server.id}`} className="text-[var(--accent)] underline-offset-2 hover:underline">
                  {t("ticketsDetail.openServer")}
                </Link>
              </div>
            ) : (
              <div className="mt-1 text-[var(--text-muted)]">{t("ticketsDetail.relatedNone")}</div>
            )}
            {canManage && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1.5 text-[11px]"
                  value={serverIdInput}
                  onChange={(e) => setServerIdInput(e.target.value)}
                  placeholder={t("ticketsDetail.serverIdPlaceholder")}
                />
                <button
                  type="button"
                  disabled={saving || !serverIdInput.trim()}
                  onClick={() => void runLink({ action: "link_server", serverId: serverIdInput.trim() })}
                  className="rounded-lg border border-[var(--accent-border)] px-2 py-1 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-50"
                >
                  {t("ticketsDetail.linkServer")}
                </button>
                <button
                  type="button"
                  disabled={saving || !timeline?.related.server}
                  onClick={() => void runLink({ action: "unlink_server" })}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {t("ticketsDetail.unlinkServer")}
                </button>
              </div>
            )}
          </div>
        </div>
        {timeline?.related.reverseTickets && timeline.related.reverseTickets.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="mb-1 font-medium text-[var(--text-primary)]">{t("ticketsDetail.reverseTickets")}</div>
            <ul className="space-y-1">
              {timeline.related.reverseTickets.map((rt) => (
                <li key={rt.id}>
                  <Link href={`/tickets/${rt.id}`} className="text-[var(--accent)] underline-offset-2 hover:underline">
                    {rt.title} · {rt.status}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div data-card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsDetail.timelineTitle")}</h3>
        {timelineLoading ? (
          <p className="text-sm text-[var(--text-muted)]">{t("ticketsDetail.timelineLoading")}</p>
        ) : !timeline || timeline.events.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t("ticketsDetail.timelineEmpty")}</p>
        ) : (
          <ol className="relative space-y-0 border-l border-[var(--border-subtle)] pl-4">
            {timeline.events.map((ev) => (
              <li key={ev.id} className="relative pb-4">
                <span className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)]" />
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span>{new Date(ev.at).toLocaleString(toDateLocale(locale))}</span>
                  <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5">
                    {eventTypeLabel(ev.type)}
                  </span>
                  {ev.actor && <span>{ev.actor}</span>}
                </div>
                <div className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">{ev.title}</div>
                {ev.detail && (
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-[var(--text-secondary)]">{ev.detail}</pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {canManage && (TRANSITIONS[ticket.status]?.length ?? 0) > 0 && (
        <div data-card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsDetail.transitionsTitle")}</h3>
          <div className="flex flex-wrap gap-2">
            {TRANSITIONS[ticket.status]!.map((s) => (
              <button key={s} onClick={() => updateStatus(s)} disabled={saving}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40">
                {t("ticketsDetail.transitionTo").replace("{status}", statusLabel(t, s))}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

      <div data-card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsDetail.commentsTitle").replace("{count}", String(ticket.comments.length))}</h3>
        {ticket.comments.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t("ticketsDetail.commentsEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {ticket.comments.map((c) => (
              <div key={c.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{c.author.displayName || c.author.username}</span>
                  <span className="text-xs text-[var(--text-muted)]">{new Date(c.createdAt).toLocaleString(toDateLocale(locale))}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="ticketComment" className="sr-only">{t("ticketsDetail.commentAria")}</label>
          <textarea id="ticketComment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("ticketsDetail.commentPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
          <button onClick={addComment} disabled={saving || !comment.trim()} data-primary
            data-action-button data-variant="primary" className="mt-2 px-4 py-2 text-sm">
            {saving ? t("ticketsDetail.commentSubmitting") : t("ticketsDetail.commentSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
