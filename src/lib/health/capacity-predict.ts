/**
 * Cross-node capacity prediction — pure math on MetricSnapshot history.
 *
 * Uses ordinary least-squares linear regression on (time → usage%) samples
 * so we can project CPU / memory / disk toward warning thresholds without a
 * separate time-series store. Offline samples are discontinuities and are
 * excluded from the fit (never treated as 0% load).
 */

export type CapacityMetricKey = "cpu" | "mem" | "disk";

export type CapacityRisk = "ok" | "watch" | "warning" | "critical" | "insufficient_data";

export type MetricSample = {
  t: number; // epoch ms
  value: number; // 0–100 usage percent
};

export type MetricForecast = {
  metric: CapacityMetricKey;
  sampleCount: number;
  windowHours: number;
  dataSpanHours: number;
  latest: number | null;
  slopePerDay: number | null;
  r2: number | null;
  projected: number | null;
  horizonDays: number;
  daysUntil85: number | null;
  daysUntil95: number | null;
  risk: CapacityRisk;
  reason: string;
};

export type ServerCapacityForecast = {
  serverId: string;
  serverName: string;
  host: string | null;
  overallRisk: CapacityRisk;
  metrics: MetricForecast[];
  sampleCount: number;
  latestSampleAt: string | null;
};

export type FleetCapacitySummary = {
  serverCount: number;
  forecastable: number;
  insufficientData: number;
  byRisk: Record<CapacityRisk, number>;
  worstRisk: CapacityRisk;
  horizonDays: number;
  windowHours: number;
  generatedAt: string;
};

const RISK_RANK: Record<CapacityRisk, number> = {
  ok: 0,
  watch: 1,
  warning: 2,
  critical: 3,
  insufficient_data: -1,
};

const MIN_SAMPLES = 6;
const MIN_SPAN_HOURS = 6;

/** Clamp usage into a sane 0–150 band (allow slight overshoot for noisy samples). */
function clampUsage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(150, Math.max(0, value));
}

/**
 * OLS linear regression y = a + b x.
 * Returns null when variance of x is zero or samples are insufficient.
 */
export function linearRegression(points: Array<{ x: number; y: number }>): {
  intercept: number;
  slope: number;
  r2: number;
} | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const pred = intercept + slope * p.x;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const r2 = ssTot < 1e-12 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  return { intercept, slope, r2 };
}

function daysUntilThreshold(
  latest: number,
  slopePerDay: number,
  threshold: number,
): number | null {
  if (latest >= threshold) return 0;
  if (slopePerDay <= 0.01) return null; // flat or declining — no breach projected
  const days = (threshold - latest) / slopePerDay;
  if (!Number.isFinite(days) || days < 0) return null;
  // Cap at 10 years so UI never shows absurd numbers
  return Math.min(days, 3650);
}

function classifyMetricRisk(input: {
  latest: number | null;
  projected: number | null;
  daysUntil85: number | null;
  daysUntil95: number | null;
  sampleCount: number;
  dataSpanHours: number;
  r2: number | null;
}): { risk: CapacityRisk; reason: string } {
  const { latest, projected, daysUntil85, daysUntil95, sampleCount, dataSpanHours, r2 } = input;

  if (sampleCount < MIN_SAMPLES || dataSpanHours < MIN_SPAN_HOURS || latest === null) {
    return {
      risk: "insufficient_data",
      reason: "need_more_samples",
    };
  }

  // Low correlation → still report slope but down-rank risk messaging
  const weakFit = r2 !== null && r2 < 0.15;

  if (latest >= 95 || (daysUntil95 !== null && daysUntil95 <= 3) || (projected !== null && projected >= 98)) {
    return { risk: "critical", reason: weakFit ? "near_full_weak_fit" : "near_full" };
  }
  if (
    latest >= 85 ||
    (daysUntil85 !== null && daysUntil85 <= 7) ||
    (daysUntil95 !== null && daysUntil95 <= 14) ||
    (projected !== null && projected >= 90)
  ) {
    return { risk: "critical", reason: weakFit ? "breach_soon_weak_fit" : "breach_soon" };
  }
  if (
    (daysUntil85 !== null && daysUntil85 <= 14) ||
    (projected !== null && projected >= 85) ||
    latest >= 75
  ) {
    return { risk: "warning", reason: weakFit ? "elevated_weak_fit" : "elevated" };
  }
  if ((daysUntil85 !== null && daysUntil85 <= 30) || (projected !== null && projected >= 75)) {
    return { risk: "watch", reason: weakFit ? "rising_weak_fit" : "rising" };
  }
  return { risk: "ok", reason: "stable" };
}

export function forecastMetric(
  samples: MetricSample[],
  metric: CapacityMetricKey,
  options: { windowHours: number; horizonDays: number; nowMs?: number },
): MetricForecast {
  const nowMs = options.nowMs ?? Date.now();
  const horizonDays = Math.min(Math.max(options.horizonDays, 1), 90);
  const windowHours = Math.min(Math.max(options.windowHours, 1), 30 * 24);

  const sorted = [...samples]
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.value))
    .map((s) => ({ t: s.t, value: clampUsage(s.value) }))
    .sort((a, b) => a.t - b.t);

  const sampleCount = sorted.length;
  const dataSpanHours =
    sampleCount >= 2 ? Math.max(0, (sorted[sampleCount - 1]!.t - sorted[0]!.t) / 3_600_000) : 0;
  const latest = sampleCount > 0 ? sorted[sampleCount - 1]!.value : null;

  if (sampleCount < MIN_SAMPLES || dataSpanHours < MIN_SPAN_HOURS || latest === null) {
    return {
      metric,
      sampleCount,
      windowHours,
      dataSpanHours: Math.round(dataSpanHours * 10) / 10,
      latest,
      slopePerDay: null,
      r2: null,
      projected: latest,
      horizonDays,
      daysUntil85: latest !== null && latest >= 85 ? 0 : null,
      daysUntil95: latest !== null && latest >= 95 ? 0 : null,
      risk: "insufficient_data",
      reason: "need_more_samples",
    };
  }

  // Normalize x as days relative to now so intercept ≈ current usage
  const points = sorted.map((s) => ({
    x: (s.t - nowMs) / 86_400_000,
    y: s.value,
  }));
  const fit = linearRegression(points);

  if (!fit) {
    const risk = classifyMetricRisk({
      latest,
      projected: latest,
      daysUntil85: latest >= 85 ? 0 : null,
      daysUntil95: latest >= 95 ? 0 : null,
      sampleCount,
      dataSpanHours,
      r2: null,
    });
    return {
      metric,
      sampleCount,
      windowHours,
      dataSpanHours: Math.round(dataSpanHours * 10) / 10,
      latest: Math.round(latest * 10) / 10,
      slopePerDay: 0,
      r2: null,
      projected: Math.round(latest * 10) / 10,
      horizonDays,
      daysUntil85: latest >= 85 ? 0 : null,
      daysUntil95: latest >= 95 ? 0 : null,
      risk: risk.risk,
      reason: risk.reason,
    };
  }

  // slope is per day (x unit = days)
  const slopePerDay = fit.slope;
  const projectedRaw = fit.intercept + slopePerDay * horizonDays;
  const projected = Math.round(clampUsage(projectedRaw) * 10) / 10;
  const latestRounded = Math.round(latest * 10) / 10;
  const daysUntil85 = daysUntilThreshold(latest, slopePerDay, 85);
  const daysUntil95 = daysUntilThreshold(latest, slopePerDay, 95);
  const risk = classifyMetricRisk({
    latest: latestRounded,
    projected,
    daysUntil85,
    daysUntil95,
    sampleCount,
    dataSpanHours,
    r2: fit.r2,
  });

  return {
    metric,
    sampleCount,
    windowHours,
    dataSpanHours: Math.round(dataSpanHours * 10) / 10,
    latest: latestRounded,
    slopePerDay: Math.round(slopePerDay * 1000) / 1000,
    r2: Math.round(fit.r2 * 1000) / 1000,
    projected,
    horizonDays,
    daysUntil85: daysUntil85 === null ? null : Math.round(daysUntil85 * 10) / 10,
    daysUntil95: daysUntil95 === null ? null : Math.round(daysUntil95 * 10) / 10,
    risk: risk.risk,
    reason: risk.reason,
  };
}

export function worstRisk(risks: CapacityRisk[]): CapacityRisk {
  let best: CapacityRisk = "insufficient_data";
  let bestRank = -2;
  for (const r of risks) {
    const rank = RISK_RANK[r];
    if (rank > bestRank) {
      best = r;
      bestRank = rank;
    }
  }
  return best;
}

export function buildServerForecast(input: {
  serverId: string;
  serverName: string;
  host?: string | null;
  cpu: MetricSample[];
  mem: MetricSample[];
  disk: MetricSample[];
  windowHours: number;
  horizonDays: number;
  nowMs?: number;
}): ServerCapacityForecast {
  const opts = {
    windowHours: input.windowHours,
    horizonDays: input.horizonDays,
    nowMs: input.nowMs,
  };
  const metrics = [
    forecastMetric(input.cpu, "cpu", opts),
    forecastMetric(input.mem, "mem", opts),
    forecastMetric(input.disk, "disk", opts),
  ];
  const overallRisk = worstRisk(metrics.map((m) => m.risk));
  const sampleCount = Math.max(...metrics.map((m) => m.sampleCount), 0);

  let latestSampleAt: string | null = null;
  for (const series of [input.cpu, input.mem, input.disk]) {
    for (const s of series) {
      if (!latestSampleAt || s.t > Date.parse(latestSampleAt)) {
        latestSampleAt = new Date(s.t).toISOString();
      }
    }
  }

  return {
    serverId: input.serverId,
    serverName: input.serverName,
    host: input.host ?? null,
    overallRisk,
    metrics,
    sampleCount,
    latestSampleAt,
  };
}

export function summarizeFleet(
  servers: ServerCapacityForecast[],
  options: { windowHours: number; horizonDays: number; nowMs?: number },
): FleetCapacitySummary {
  const byRisk: Record<CapacityRisk, number> = {
    ok: 0,
    watch: 0,
    warning: 0,
    critical: 0,
    insufficient_data: 0,
  };
  for (const s of servers) {
    byRisk[s.overallRisk] += 1;
  }
  const forecastable = servers.filter((s) => s.overallRisk !== "insufficient_data").length;
  return {
    serverCount: servers.length,
    forecastable,
    insufficientData: byRisk.insufficient_data,
    byRisk,
    worstRisk: worstRisk(servers.map((s) => s.overallRisk)),
    horizonDays: options.horizonDays,
    windowHours: options.windowHours,
    generatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
  };
}
