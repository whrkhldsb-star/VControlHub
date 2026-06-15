"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

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

const LEVEL_LABEL: Record<JobEventLevel, string> = {
  info: "信息",
  warn: "告警",
  error: "错误",
};

const TYPE_LABEL: Record<string, string> = {
  claimed: "认领",
  heartbeat: "心跳",
  progress: "进度",
  completed: "完成",
  failed: "失败",
  retrying: "重试",
  recovered: "恢复",
  cancelled: "取消",
  enqueued: "入队",
};

function levelTone(level: string): "info" | "warn" | "error" {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  return "info";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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
        setError(err instanceof Error ? err.message : "加载任务事件失败");
      } finally {
        setLoading(false);
      }
    },
    [jobId, open, events],
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-events-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-slate-950/98 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 id="job-events-dialog-title" className="text-sm font-semibold text-white">
              任务事件流
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              jobId <span className="font-mono text-slate-300">{jobId}</span> · 按时间倒序展示认领、心跳、完成、失败、重试等事件
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05]"
          >
            关闭
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {error ? (
            <div role="alert" data-tone="rose" className="rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
          {loading && events.length === 0 ? (
            <p className="text-sm text-slate-500">加载中…</p>
          ) : null}
          {!loading && !error && events.length === 0 ? (
            <p className="text-sm text-slate-500">该任务暂无事件记录</p>
          ) : null}
          {events.length > 0 ? (
            <ol className="space-y-2">
              {events.map((event) => {
                const tone = levelTone(event.level);
                const typeLabel = TYPE_LABEL[event.type] ?? event.type;
                const summary = summarizePayload(event.payload);
                return (
                  <li
                    key={event.id}
                    data-tone={tone}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-200"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">{typeLabel}</span>
                      <span data-tone={tone} className="rounded border px-1.5 py-0.5 text-[10px] font-medium">
                        {LEVEL_LABEL[tone]}
                      </span>
                      <span className="text-slate-500">{formatTime(event.createdAt)}</span>
                      {event.workerId ? (
                        <span className="font-mono text-[10px] text-slate-500" title="worker id">
                          {event.workerId}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-slate-300">{event.message}</p>
                    {summary ? (
                      <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400">
                        {summary}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-xs text-slate-500">
          <span>共 {events.length} 条{hasMore ? "，可加载更多" : ""}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load(false)}
              disabled={loading}
              className="rounded-md border border-white/[0.08] px-3 py-1.5 text-slate-300 hover:bg-white/[0.05] disabled:opacity-50"
            >
              刷新
            </button>
            {hasMore ? (
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={loading}
                className="rounded-md border border-white/[0.08] px-3 py-1.5 text-slate-300 hover:bg-white/[0.05] disabled:opacity-50"
              >
                加载更早事件
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
