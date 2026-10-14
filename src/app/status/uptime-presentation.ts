import { HEALTH_SAMPLE_INTERVAL_MINUTES } from "@/lib/health/service-types";

export type UptimeSample = {
  uptimePercent: number;
  checkCount: number;
  /** Minutes covered by samples (online + offline minutes of the rollup). */
  onlineMinutes?: number;
  offlineMinutes?: number;
};

/**
 * A day's uptimePercent is the online share of the time its samples cover.
 * It says nothing about time no sample covered (sampler down, host added
 * mid-day), so it is shown together with the covered share of the day; below
 * MIN_SAMPLE_COVERAGE the percentage is marked as insufficient instead of
 * being presented as availability.
 *
 * Coverage is measured in minutes, not in "expected number of samples": the
 * sampling interval is configurable, so the count a day "should" have depends
 * on the cadence at the time, which the rollup already accounts for.
 */
export const MIN_SAMPLE_COVERAGE = 0.5;

/** Minutes of a day that could have been covered; today only up to now. */
export function expectedMinutesForDay(minutesElapsed = 1440): number {
  return Math.max(1, Math.min(1440, Math.floor(minutesElapsed)));
}

/** Covered minutes of a rollup row (older rows without minutes: samples × the former fixed cadence). */
export function coveredMinutes(day: UptimeSample): number {
  if (typeof day.onlineMinutes === "number" || typeof day.offlineMinutes === "number") {
    return Math.max(0, (day.onlineMinutes ?? 0) + (day.offlineMinutes ?? 0));
  }
  return day.checkCount * HEALTH_SAMPLE_INTERVAL_MINUTES;
}

export function describeUptimeDay(day: UptimeSample, expectedMinutes: number) {
  const sampled = day.checkCount > 0;
  const covered = coveredMinutes(day);
  const coverage = Math.min(1, covered / Math.max(1, expectedMinutes));
  return {
    sampled,
    coverage,
    coveragePercent: Math.round(coverage * 100),
    sufficient: sampled && coverage >= MIN_SAMPLE_COVERAGE,
    unknownMinutes: Math.max(0, Math.round(expectedMinutes - covered)),
  };
}

export function getUptimeColorClass(uptime: number, sampled: boolean, sufficient = true) {
  if (!sampled) return "bg-[var(--surface-hover)]";
  // Too few samples to call the day up or down: neutral fill, warning outline.
  if (!sufficient) return "bg-[var(--surface-hover)] ring-1 ring-inset ring-[var(--warning)]";
  if (uptime >= 99) return "bg-[var(--success)]";
  if (uptime >= 95) return "bg-[var(--info)]";
  if (uptime >= 90) return "bg-[var(--warning)]";
  if (uptime >= 75) return "bg-[var(--danger)]/50";
  return "bg-[var(--danger)]";
}

/** Availability over several days, weighted by each day's covered time. */
export function calculateWeightedSla(days: UptimeSample[]): number | null {
  const sampled = days.filter((day) => day.checkCount > 0);
  const total = sampled.reduce((sum, day) => sum + coveredMinutes(day), 0);
  if (total === 0) return null;
  const weighted = sampled.reduce((sum, day) => sum + day.uptimePercent * coveredMinutes(day), 0);
  return Math.round((weighted / total) * 100) / 100;
}

/**
 * Covered share of the window from the first sampled day to today (days
 * before the first sample are a host that was not monitored yet, not a gap).
 */
export function calculateWindowCoverage(days: Array<UptimeSample & { expectedMinutes: number }>) {
  const first = days.findIndex((day) => day.checkCount > 0);
  if (first < 0) return null;
  const window = days.slice(first);
  const expected = window.reduce((sum, day) => sum + day.expectedMinutes, 0);
  const observed = window.reduce((sum, day) => sum + Math.min(coveredMinutes(day), day.expectedMinutes), 0);
  const coverage = expected > 0 ? observed / expected : 0;
  return { coverage, coveragePercent: Math.round(coverage * 100), sufficient: coverage >= MIN_SAMPLE_COVERAGE };
}
