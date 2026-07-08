"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";

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

function buildLevelLabels(t: (key: string) => string): Record<JobEventLevel, string> {
	return {
		info: t("jobEventsDialog.level.info"),
		warn: t("jobEventsDialog.level.warn"),
		error: t("jobEventsDialog.level.error"),
	};
}

function buildTypeLabels(t: (key: string) => string): Record<string, string> {
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

export function JobEventsDialog({ jobId, open, onClose }: JobEventsDialogProps) {
  const { t, locale } = useI18n();
  const levelLabels = buildLevelLabels(t);
  const typeLabels = buildTypeLabels(t);
  const [events, setEvents] = useState<JobEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>({ open, onClose, initialFocusRef: closeButtonRef });

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
        setError(err instanceof Error ? err.message : t("jobEventsDialog.loadError"));
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

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !jobId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[10vh] pb-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-events-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 id="job-events-dialog-title" className="text-sm font-semibold text-[var(--text-primary)]">
              {t("jobEventsDialog.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("jobEventsDialog.subtitle").replace("{id}", jobId)}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("jobEventsDialog.closeAria")}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            {t("jobEventsDialog.close")}
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {error ? (
            <div role="alert" data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </div>
          ) : null}
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
                    className="rounded-lg border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] px-3 py-2 text-xs text-[var(--text-primary)]"
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
                    <p className="mt-1 break-words text-[var(--text-secondary)]">{event.message}</p>
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
          <span>{t("jobEventsDialog.totalCount").replace("{count}", String(events.length)).replace("{more}", hasMore ? t("jobEventsDialog.moreSuffix") : "")}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load(false)}
              disabled={loading}
              className="rounded-lg border border-[var(--border)]/[0.10] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] disabled:opacity-50"
            >
              {t("jobEventsDialog.refresh")}
            </button>
            {hasMore ? (
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={loading}
                className="rounded-lg border border-[var(--border)]/[0.10] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] disabled:opacity-50"
              >
                {t("jobEventsDialog.loadMore")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
