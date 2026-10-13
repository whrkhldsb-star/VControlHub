import { HEALTH_SAMPLE_INTERVAL_MINUTES } from "@/lib/health/service-types";

export type UptimeSample = {
  uptimePercent: number;
  checkCount: number;
};

/**
 * A day's uptimePercent is the share of the samples that were taken which
 * found the host online. It says nothing about the time no sample was taken
 * (sampler down, host added mid-day), so it is shown together with how many
 * of the expected samples exist; below MIN_SAMPLE_COVERAGE the percentage is
 * marked as insufficient instead of being presented as availability.
 */
export const EXPECTED_CHECKS_PER_DAY = Math.round(1440 / HEALTH_SAMPLE_INTERVAL_MINUTES);
export const MIN_SAMPLE_COVERAGE = 0.5;

/** Samples a full day should have; today only up to the time elapsed. */
export function expectedChecksForDay(minutesElapsed = 1440): number {
  return Math.max(1, Math.min(EXPECTED_CHECKS_PER_DAY, Math.floor(minutesElapsed / HEALTH_SAMPLE_INTERVAL_MINUTES)));
}

export function describeUptimeDay(day: UptimeSample, expectedChecks: number) {
  const sampled = day.checkCount > 0;
  const coverage = Math.min(1, day.checkCount / Math.max(1, expectedChecks));
  return {
    sampled,
    coverage,
    coveragePercent: Math.round(coverage * 100),
    sufficient: sampled && coverage >= MIN_SAMPLE_COVERAGE,
    unknownMinutes: Math.max(0, expectedChecks - day.checkCount) * HEALTH_SAMPLE_INTERVAL_MINUTES,
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

export function calculateWeightedSla(days: UptimeSample[]): number | null {
  const sampled = days.filter((day) => day.checkCount > 0);
  const totalChecks = sampled.reduce((sum, day) => sum + day.checkCount, 0);
  if (totalChecks === 0) return null;
  const weighted = sampled.reduce(
    (sum, day) => sum + day.uptimePercent * day.checkCount,
    0,
  );
  return Math.round((weighted / totalChecks) * 100) / 100;
}

/**
 * Sample coverage of the window from the first sampled day to today (days
 * before the first sample are a host that was not monitored yet, not a gap).
 */
export function calculateWindowCoverage(days: Array<UptimeSample & { expectedChecks: number }>) {
  const first = days.findIndex((day) => day.checkCount > 0);
  if (first < 0) return null;
  const window = days.slice(first);
  const expected = window.reduce((sum, day) => sum + day.expectedChecks, 0);
  const observed = window.reduce((sum, day) => sum + Math.min(day.checkCount, day.expectedChecks), 0);
  const coverage = expected > 0 ? observed / expected : 0;
  return { coverage, coveragePercent: Math.round(coverage * 100), sufficient: coverage >= MIN_SAMPLE_COVERAGE };
}
