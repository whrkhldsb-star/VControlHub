"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import type { Locale } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { InlineLoading, Notice } from "@/components/ui-primitives";
import { RefreshCw } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

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

function levelTone(level: string): JobEventLevel {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  return "info";
}

/**
 * `data-tone` only carries a background for the seven hue names in globals.css,
 * so `data-tone="warn"` styled nothing — every level badge looked the same.
 */
const LEVEL_BADGE_TONE: Record<JobEventLevel, StatusTone> = {
  info: "info",
  warn: "warning",
  error: "danger",
};

function formatTime(value: string, locale?: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date, locale ?? "zh", value);
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
  const { t, locale } = useI18n();
  const levelLabels = buildLevelLabels(t);
  const typeLabels = buildTypeLabels(t);
  const [events, setEvents] = useState<JobEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const cursorRef = useRef<string | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      if (!jobId || !open) return;
      if (append && requestRef.current) return;
      requestRef.current?.abort();
      const request = new AbortController();
      requestRef.current = request;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "100");
        if (append && cursorRef.current) {
          params.set("beforeId", cursorRef.current);
        }
        const data = await csrfFetch<{ events: JobEventRow[] }>(
          `/api/jobs/${encodeURIComponent(jobId)}/events?${params.toString()}`,
          { signal: request.signal },
        );
        if (request.signal.aborted || requestRef.current !== request) return;
        const next = data.events ?? [];
        cursorRef.current = next.at(-1)?.id ?? null;
        if (append) {
          setEvents((prev) => Array.from(new Map([...prev, ...next].map((event) => [event.id, event])).values()));
        } else {
          setEvents(next);
        }
        setHasMore(next.length >= 100);
      } catch (err) {
        if (request.signal.aborted || requestRef.current !== request) return;
        setError(getErrorMessage(err, t("jobEventsDialog.loadError")));
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    },
    [jobId, open, t],
  );

  useEffect(() => {
    cursorRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A different task owns a different event list.
    setEvents([]);
    setHasMore(false);
    setError(null);
    setLoading(false);
    if (open && jobId) {
      void load(false);
    }
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [open, jobId, load]);

  if (!open || !jobId) return null;

  return (
    <Dialog
      size="2xl"
      open={open}
      onClose={onClose}
      title={t("jobEventsDialog.title")}
      description={<span className="break-words">{t("jobEventsDialog.subtitle", { id: jobId })}</span>}
      closeLabel={t("jobEventsDialog.closeAria")}
      closeButtonRef={closeButtonRef}
      initialFocusRef={closeButtonRef}
      footer={<>
        <span className="text-xs text-[var(--text-muted)] sm:mr-auto sm:self-center">
          {t("jobEventsDialog.totalCount", { count: events.length, more: hasMore ? t("jobEventsDialog.moreSuffix") : "" })}
        </span>
        <ActionButton variant="secondary" icon={<RefreshCw aria-hidden />} onClick={() => void load(false)} disabled={loading}>
          {t("jobEventsDialog.refresh")}
        </ActionButton>
        {hasMore ? (
          <ActionButton variant="secondary" onClick={() => void load(true)} disabled={loading}>
            {t("jobEventsDialog.loadMore")}
          </ActionButton>
        ) : null}
      </>}
    >
        <div aria-busy={loading}>
          {error ? <Notice tone="danger" compact>{error}</Notice> : null}
          {loading && events.length === 0 ? (
            <InlineLoading label={t("jobEventsDialog.loading")} />
          ) : null}
          {!loading && !error && events.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t("jobEventsDialog.empty")}</p>
          ) : null}
          {events.length > 0 ? (
            <ol className="divide-y divide-[var(--border-subtle)]">
              {events.map((event) => {
                const tone = levelTone(event.level);
                const typeLabel = typeLabels[event.type] ?? event.type;
                const summary = summarizePayload(event.payload);
                return (
                  <li
                    key={event.id}
                    className="min-w-0 py-3 text-xs text-[var(--text-primary)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{typeLabel}</span>
                      <StatusBadge tone={LEVEL_BADGE_TONE[tone]}>{levelLabels[tone]}</StatusBadge>
                      <span className="text-[var(--text-muted)]">{formatTime(event.createdAt, locale)}</span>
                      {event.workerId ? (
                        <span className="break-all font-mono text-xs text-[var(--text-muted)]" title={t("jobEventsDialog.workerIdTitle")}>
                          {event.workerId}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-[var(--text-secondary)]">{displayEventMessage(event, t)}</p>
                    {summary ? (
                      <pre tabIndex={0} aria-label={typeLabel} data-inset className="mt-2 max-h-32 overflow-auto px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                        {summary}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
    </Dialog>
  );
}
