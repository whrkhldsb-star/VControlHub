/**
 * SyncJob schedule helpers (presets + cron).
 *
 * Stored in SyncJob.schedule as:
 * - null / "" / "manual" → manual only
 * - "every:15m" | "every:1h" | "every:6h" | "every:24h"
 * - standard 5-field cron (via cron-parser)
 */
import { CronExpressionParser } from "cron-parser";

export const SYNC_SCHEDULE_PRESETS = [
  { value: "manual", labelKey: "filesPage.syncJobs.schedule.manual" },
  { value: "every:15m", labelKey: "filesPage.syncJobs.schedule.every15m" },
  { value: "every:1h", labelKey: "filesPage.syncJobs.schedule.every1h" },
  { value: "every:6h", labelKey: "filesPage.syncJobs.schedule.every6h" },
  { value: "every:24h", labelKey: "filesPage.syncJobs.schedule.every24h" },
] as const;

const INTERVAL_MS: Record<string, number> = {
  "every:15m": 15 * 60_000,
  "every:1h": 60 * 60_000,
  "every:6h": 6 * 60 * 60_000,
  "every:24h": 24 * 60 * 60_000,
};

export function normalizeSyncSchedule(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s === "manual") return null;
  return s;
}

export function intervalMsForSchedule(schedule: string | null | undefined): number | null {
  const s = normalizeSyncSchedule(schedule);
  if (!s) return null;
  if (INTERVAL_MS[s] != null) return INTERVAL_MS[s]!;
  return null;
}

export function isValidSyncSchedule(raw: string | null | undefined): boolean {
  const s = normalizeSyncSchedule(raw);
  if (s == null) return true;
  if (INTERVAL_MS[s] != null) return true;
  try {
    CronExpressionParser.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a job should run now based on schedule + lastSyncAt.
 * RUNNING/PAUSED jobs are never due.
 */
export function isSyncJobDue(input: {
  schedule: string | null | undefined;
  lastSyncAt: Date | null | undefined;
  status: string;
  now?: Date;
}): boolean {
  if (input.status === "RUNNING" || input.status === "PAUSED") return false;
  const s = normalizeSyncSchedule(input.schedule);
  if (!s) return false;
  const now = input.now ?? new Date();
  const last = input.lastSyncAt ? new Date(input.lastSyncAt) : null;

  const intervalMs = INTERVAL_MS[s];
  if (intervalMs != null) {
    if (!last) return true;
    return now.getTime() - last.getTime() >= intervalMs;
  }

  try {
    const expr = CronExpressionParser.parse(s, {
      currentDate: last ?? new Date(0),
    });
    const next = expr.next().toDate();
    return next.getTime() <= now.getTime();
  } catch {
    return false;
  }
}
