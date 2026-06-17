"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
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
  OPEN: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
  IN_PROGRESS: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  RESOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  CLOSED: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};
const PRIORITY_TONE: Record<string, string> = {
  LOW: "text-slate-400", NORMAL: "text-slate-300", HIGH: "text-amber-400", URGENT: "text-rose-400",
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

export function TicketDetailClient({ initial, canManage, locale: _locale }: TicketDetailClientProps) {
  const { t } = useI18n();
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
    <div data-card className="space-y-6">
      <Link href="/tickets" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 light:hover:text-slate-700 transition-colors">
        {t("ticketsDetail.backToList")}
      </Link>
      {/* Ticket header */}
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">{ticket.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs ${STATUS_TONE[ticket.status] ?? ""}`}>
                {statusLabel(t, ticket.status)}
              </span>
              <span className={`text-xs ${PRIORITY_TONE[ticket.priority] ?? ""}`}>
                {priorityLabel(t, ticket.priority)}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>{t("ticketsDetail.createdAt").replace("{time}", new Date(ticket.createdAt).toLocaleString("zh-CN"))}</p>
            <p>{t("ticketsDetail.updatedAt").replace("{time}", new Date(ticket.updatedAt).toLocaleString("zh-CN"))}</p>
            {ticket.closedAt && <p>{t("ticketsDetail.closedAt").replace("{time}", new Date(ticket.closedAt).toLocaleString("zh-CN"))}</p>}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-white/[0.04] bg-black/20 p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{ticket.description}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 text-xs text-slate-500">
          <span>{t("ticketsDetail.creator").replace("{name}", ticket.creator.displayName || ticket.creator.username)}</span>
          {ticket.assignee && <span>{t("ticketsDetail.assignee").replace("{name}", ticket.assignee.displayName || ticket.assignee.username)}</span>}
        </div>

        {canManage && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-slate-500 shrink-0">{t("ticketsDetail.assignTo")}</span>
            <select
              value={assigneeId}
              onChange={(e) => { setAssigneeId(e.target.value); void updateAssignee(e.target.value); }}
              disabled={saving}
              aria-label={t("ticketsDetail.assignAria")}
              className="rounded-lg border border-white/[0.08] bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-50"
            >
              <option value="">{t("ticketsDetail.unassigned")}</option>
              {/* users populated from parent page */}
            </select>
          </div>
        )}
      </div>

      {/* Status transitions */}
      {canManage && (TRANSITIONS[ticket.status]?.length ?? 0) > 0 && (
        <div data-card className="p-5">
          <h3 className="text-sm font-medium text-white mb-3">{t("ticketsDetail.transitionsTitle")}</h3>
          <div className="flex flex-wrap gap-2">
            {TRANSITIONS[ticket.status]!.map((s) => (
              <button key={s} onClick={() => updateStatus(s)} disabled={saving}
                className="rounded-lg border border-[var(--border)] bg-white/[0.04] px-4 py-2 text-sm text-white hover:bg-white/[0.08] transition-colors disabled:opacity-40">
                {t("ticketsDetail.transitionTo").replace("{status}", statusLabel(t, s))}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {/* Comments */}
      <div data-card className="p-5">
        <h3 className="text-sm font-medium text-white mb-4">{t("ticketsDetail.commentsTitle").replace("{count}", String(ticket.comments.length))}</h3>
        {ticket.comments.length === 0 ? (
          <p className="text-sm text-slate-500">{t("ticketsDetail.commentsEmpty")}</p>
        ) : (
          <div className="space-y-4">
            {ticket.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-white/[0.04] bg-black/20 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{c.author.displayName || c.author.username}</span>
                  <span className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString("zh-CN")}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add comment */}
        <div className="mt-4">
          <label htmlFor="ticketComment" className="sr-only">{t("ticketsDetail.commentAria")}</label>
          <textarea id="ticketComment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("ticketsDetail.commentPlaceholder")}
            rows={3}
            className="w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 resize-none" />
          <button onClick={addComment} disabled={saving || !comment.trim()}
            className="mt-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40">
            {saving ? t("ticketsDetail.commentSubmitting") : t("ticketsDetail.commentSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
