"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { ModalShell } from "@/components/modal-shell";

type JobEventLevel = "info" | "warn" | "error";

type JobEventRow = {
  id: string;
  jobId: string;
  type: string;
  level: string;
  message: string;
  workerId: string | null;
  payload: unknown;
  createdAt: string;
};

type JobEventsDialogProps = {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
};

function buildLevelLabels(t: (key: string, vars?: Record<string, string | number>) => string): Record<JobEventLevel, string> {
	return {
		info: t("jobEventsDialog.level.info"),
		warn: t("jobEventsDialog.level.warn"),
		error: t("jobEventsDialog.level.error"),
	};
}

function buildTypeLabels(t: (key: string, vars?: Record<string, string | number>) => string): Record<string, string> {
	return {
		claimed: t("jobEventsDialog.type.claimed"),
		heartbeat: t("jobEventsDialog.type.heartbeat"),
		progress: t("jobEventsDialog.type.progress"),
		completed: t("jobEventsDialog.type.completed"),
		failed: t("jobEventsDialog.type.failed"),
		retrying: t("jobEventsDialog.type.retrying"),
		recovered: t("jobEventsDialog.type.recovered"),
		cancelled: t("jobEventsDialog.type.cancelled"),
		enqueued: t("jobEventsDialog.type.enqueued"),
	};
}

function levelTone(level: string): "info" | "warn" | "error" {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  return "info";
}

function formatTime(value: string, locale?: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(toDateLocale(locale ?? "zh"), { hour12: false });
}

function summarizePayload(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function displayEventMessage(
  event: JobEventRow,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const payload = event.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : null;
  if (event.type === "enqueued") {
    return t("jobEventsDialog.message.enqueued", {
      type: String(payload?.type ?? "-"),
      priority: String(payload?.priority ?? "-"),
    });
  }
  if (event.type === "claimed") {
    return t("jobEventsDialog.message.claimed", { worker: event.workerId ?? "-" });
  }
  if (event.type === "completed" && event.message === "Task completed") {
    return t("jobEventsDialog.message.completed");
  }
  if (event.type === "cancelled" && event.message === "Task cancelled") {
    return t("jobEventsDialog.message.cancelled");
  }
  if (event.type === "recovered" && event.message === "Background executor heartbeat expired; re-enqueued") {
    return t("jobEventsDialog.message.recovered");
  }
  if (event.type === "failed" && event.message === "Background executor heartbeat expired after exhausting attempts") {
    return t("jobEventsDialog.message.heartbeatExhausted");
  }
  return event.message;
}

export function JobEventsDialog({ jobId, open, onClose }: JobEventsDialogProps) {
  const { t } = useI18n();
  const levelLabels = buildLevelLabels(t);
  const typeLabels = buildTypeLabels(t);
  const [events, setEvents] = useState<JobEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      if (!jobId || !open) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "100");
        if (append && events.length > 0) {
          params.set("beforeId", events[events.length - 1]?.id ?? "");
        }
        const data = await csrfFetch<{ events: JobEventRow[] }>(
          `/api/jobs/${encodeURIComponent(jobId)}/events?${params.toString()}`,
        );
        const next = data.events ?? [];
        if (append) {
          setEvents((prev) => [...prev, ...next]);
        } else {
          setEvents(next);
        }
        setHasMore(next.length >= 100);
      } catch (err) {
        setError(getErrorMessage(err, t("jobEventsDialog.loadError")));
      } finally {
        setLoading(false);
      }
    },
    [jobId, open, events, t],
  );

  useEffect(() => {
    if (open && jobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- open/jobId 变化时重新拉取, 业务上需要 setState-in-effect
      void load(false);
    } else if (!open) {
      setEvents([]);
      setHasMore(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  if (!open || !jobId) return null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      labelledBy="job-events-dialog-title"
      initialFocusRef={closeButtonRef}
      overlayClassName="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--overlay)] backdrop-blur-sm px-4 pt-[10vh] pb-8"
      panelClassName="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] shadow-2xl"
    >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="job-events-dialog-title" className="text-sm font-semibold text-[var(--text-primary)]">
              {t("jobEventsDialog.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("jobEventsDialog.subtitle", { id: jobId })}
            </p>
          </div>
          <ActionButton variant="secondary"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={t("jobEventsDialog.closeAria")} className="!px-3 !py-1.5 !text-xs"
          >
            {t("jobEventsDialog.close")}
          </ActionButton>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {error ? <Notice tone="danger" compact>{error}</Notice> : null}
          {loading && events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t("jobEventsDialog.loading")}</p>
          ) : null}
          {!loading && !error && events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t("jobEventsDialog.empty")}</p>
          ) : null}
          {events.length > 0 ? (
            <ol className="space-y-2">
              {events.map((event) => {
                const tone = levelTone(event.level);
                const typeLabel = typeLabels[event.type] ?? event.type;
                const summary = summarizePayload(event.payload);
                return (
                  <li
                    key={event.id}
                    data-tone={tone}
                    className="rounded-lg border border-[var(--border)]/[0.10] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{typeLabel}</span>
                      <span data-tone={tone} className="rounded-lg border px-1.5 py-0.5 text-[10px] font-medium">
                        {levelLabels[tone]}
                      </span>
                      <span className="text-[var(--text-muted)]">{formatTime(event.createdAt)}</span>
                      {event.workerId ? (
                        <span className="font-mono text-[10px] text-[var(--text-muted)]" title={t("jobEventsDialog.workerIdTitle")}>
                          {event.workerId}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-[var(--text-secondary)]">{displayEventMessage(event, t)}</p>
                    {summary ? (
                      <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-[var(--surface-subtle)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                        {summary}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)]/[0.10] px-5 py-3 text-xs text-[var(--text-muted)]">
          <span>{t("jobEventsDialog.totalCount", { count: events.length, more: hasMore ? t("jobEventsDialog.moreSuffix") : "" })}</span>
          <div className="flex gap-2">
            <ActionButton variant="secondary"
              onClick={() => void load(false)}
              disabled={loading}
             
              className="!px-3 !py-1.5 !text-xs disabled:opacity-50"
            >
              {t("jobEventsDialog.refresh")}
            </ActionButton>
            {hasMore ? (
              <ActionButton variant="secondary"
                onClick={() => void load(true)}
                disabled={loading}
               
                className="!px-3 !py-1.5 !text-xs disabled:opacity-50"
              >
                {t("jobEventsDialog.loadMore")}
              </ActionButton>
            ) : null}
          </div>
        </div>
    </ModalShell>
  );
}
