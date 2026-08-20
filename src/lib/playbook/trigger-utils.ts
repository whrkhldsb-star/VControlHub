import { CronExpressionParser } from "cron-parser";

import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";

import type {
  MetricName,
  MetricTriggerConfig,
  Operator,
  TriggerConfig,
} from "./types";

export type MetricMatchStateEntry = {
  breached: boolean;
  sampleAt: string;
  value: number;
};

export type MetricMatchState = Record<string, MetricMatchStateEntry>;

/**
 * Normalize and validate the product's documented five-field Cron format.
 * cron-parser also accepts six-field expressions, so field count is checked
 * explicitly before parsing.
 */
export function normalizePlaybookCronExpression(raw: string): string {
  const expression = raw.trim().split(/\s+/).filter(Boolean).join(" ");
  if (expression.split(" ").length !== 5) {
    throw new Error("Cron expression must have 5 fields (minute hour day month weekday)");
  }
  CronExpressionParser.parse(expression, { tz: APP_TIME_ZONE });
  return expression;
}

export function isValidPlaybookCronExpression(raw: string): boolean {
  try {
    normalizePlaybookCronExpression(raw);
    return true;
  } catch {
    return false;
  }
}

export function computeNextPlaybookCronRun(
  expression: string,
  from: Date = new Date(),
): Date {
  const normalized = normalizePlaybookCronExpression(expression);
  return CronExpressionParser.parse(normalized, {
    currentDate: from,
    tz: APP_TIME_ZONE,
  }).next().toDate();
}

export function isCronTriggerConfig(value: unknown): value is { expression: string } {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && typeof (value as { expression?: unknown }).expression === "string",
  );
}

export function isMetricTriggerConfig(value: unknown): value is MetricTriggerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Partial<MetricTriggerConfig>;
  return (
    (config.metric === "cpu_usage" || config.metric === "mem_usage" || config.metric === "disk_usage")
    && (config.operator === "gt" || config.operator === "gte" || config.operator === "lt" || config.operator === "lte" || config.operator === "eq")
    && typeof config.threshold === "number"
    && Number.isFinite(config.threshold)
  );
}

export function assertValidPlaybookTriggerConfig(
  triggerType: "cron" | "metric",
  triggerConfig: TriggerConfig | unknown,
): void {
  if (triggerType === "cron") {
    if (!isCronTriggerConfig(triggerConfig)) {
      throw new Error("Cron trigger requires the expression field");
    }
    normalizePlaybookCronExpression(triggerConfig.expression);
    return;
  }
  if (!isMetricTriggerConfig(triggerConfig)) {
    throw new Error("Metric trigger requires metric / operator / threshold fields");
  }
}

export function metricValueForTrigger(
  metric: MetricName,
  reading: { cpu?: number; mem?: number; diskMax?: number },
): number | undefined {
  if (metric === "cpu_usage") return reading.cpu;
  if (metric === "mem_usage") return reading.mem;
  return reading.diskMax;
}

export function metricMatchesThreshold(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
  }
}

export function parseMetricMatchState(raw: unknown): MetricMatchState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const state: MetricMatchState = {};
  for (const [serverId, candidate] of Object.entries(raw as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const entry = candidate as Partial<MetricMatchStateEntry>;
    if (
      typeof entry.breached !== "boolean"
      || typeof entry.sampleAt !== "string"
      || typeof entry.value !== "number"
      || !Number.isFinite(entry.value)
      || !Number.isFinite(Date.parse(entry.sampleAt))
    ) {
      continue;
    }
    state[serverId] = {
      breached: entry.breached,
      sampleAt: new Date(entry.sampleAt).toISOString(),
      value: entry.value,
    };
  }
  return state;
}
