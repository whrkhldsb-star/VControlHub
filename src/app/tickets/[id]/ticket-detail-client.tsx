"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import Link from "next/link";

export interface TicketUser { id: string; username: string; displayName: string | null; }
export interface TicketComment { id: string; body: string; createdAt: string; author: TicketUser; }
export interface Ticket {
  id: string; title: string; description: string; status: string; priority: string;
  createdBy: string; assigneeId: string | null; createdAt: string; updatedAt: string; closedAt: string | null;
  creator: TicketUser; assignee: TicketUser | null; comments: TicketComment[];
}

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

// Valid status transitions
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
};

export function TicketDetailClient({ initial, canManage, users = [], locale: _locale }: TicketDetailClientProps) {
  const { t, locale } = useI18n();
  const [ticket, setTicket] = useState(initial);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId ?? "");

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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("ticketsDetail.error.updateFailed")); }
    finally { setSaving(false); }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ comment: TicketComment }>(`/api/tickets/${ticket.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment.trim() }) });
      setTicket((prev) => ({ ...prev, comments: [...prev.comments, data.comment], updatedAt: new Date().toISOString() }));
      setComment("");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t("ticketsDetail.error.replyFailed")); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
        {t("ticketsDetail.backToList")}
      </Link>
      {/* Ticket header */}
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
              className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] outline-none disabled:opacity-50"
            >
              <option value="">{t("ticketsDetail.unassigned")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Status transitions */}
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

      {/* Comments */}
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

        {/* Add comment */}
        <div className="mt-4">
          <label htmlFor="ticketComment" className="sr-only">{t("ticketsDetail.commentAria")}</label>
          <textarea id="ticketComment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("ticketsDetail.commentPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
          <button onClick={addComment} disabled={saving || !comment.trim()} data-primary
            data-action-button data-variant="primary" className="mt-2 px-4 py-2 text-sm">
            {saving ? t("ticketsDetail.commentSubmitting") : t("ticketsDetail.commentSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
