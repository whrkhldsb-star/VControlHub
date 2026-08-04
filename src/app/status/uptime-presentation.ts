export type UptimeSample = {
  uptimePercent: number;
  checkCount: number;
};

export function getUptimeColorClass(uptime: number, sampled: boolean) {
  if (!sampled) return "bg-[var(--surface-hover)]";
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
