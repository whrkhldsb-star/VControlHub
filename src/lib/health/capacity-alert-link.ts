/**
 * Optional capacity-forecast → alert-rule linkage.
 *
 * When an AlertRule uses one of the capacity_* metrics, evaluateAlerts
 * calls into this module instead of live health gauges. Threshold is
 * interpreted in **days until projected 85% usage** (or 0 if already ≥85%).
 *
 * Example: metric=capacity_disk_days, operator=lte, threshold=14
 *   → fire when disk is projected to hit 85% within 14 days.
 *
 * Rules with insufficient_data or non-increasing slope never fire (and
 * resolve any open incident for that fingerprint).
 */
import { prisma } from "@/lib/db";
import {
  openOrRefreshAlertIncident,
  resolveAlertIncident,
} from "@/lib/alert/incidents";
import { createLogger } from "@/lib/logging";
import { runPlaybook } from "@/lib/playbook/service";

import {
  getCapacityForecast,
  type CapacityForecastResult,
} from "./capacity-service";
import type { CapacityMetricKey, ServerCapacityForecast } from "./capacity-predict";

const logger = createLogger("health:capacity-alert");

export const CAPACITY_ALERT_METRICS = [
  "capacity_cpu_days",
  "capacity_mem_days",
  "capacity_disk_days",
] as const;

export type CapacityAlertMetric = (typeof CAPACITY_ALERT_METRICS)[number];

export function isCapacityAlertMetric(metric: string): metric is CapacityAlertMetric {
  return (CAPACITY_ALERT_METRICS as readonly string[]).includes(metric);
}

export function capacityMetricKeyFromAlertMetric(
  metric: CapacityAlertMetric,
): CapacityMetricKey {
  if (metric === "capacity_cpu_days") return "cpu";
  if (metric === "capacity_mem_days") return "mem";
  return "disk";
}

/** Extract the numeric days-to-85 value used for threshold comparison. */
export function daysValueFromServerForecast(
  server: ServerCapacityForecast,
  key: CapacityMetricKey,
): { value: number | null; reason: string } {
  const mf = server.metrics.find((m) => m.metric === key);
  if (!mf) return { value: null, reason: "metric_missing" };
  if (mf.risk === "insufficient_data") {
    return { value: null, reason: "insufficient_data" };
  }
  if (mf.daysUntil85 === null) {
    // Never projected to hit 85% (flat/declining or far future).
    return { value: null, reason: mf.reason || "not_projected" };
  }
  return { value: mf.daysUntil85, reason: mf.reason };
}

function compare(operator: string, value: number, threshold: number): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    default:
      return false;
  }
}

export type CapacityAlertRuleSlice = {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  operator: string;
  enabled: boolean;
  lastMatchedAt: Date | null;
  lastTriggeredAt: Date | null;
  cooldownMinutes: number;
  silenceWindows: string[];
  serverIds: string[];
  notifyChannels: string[];
  playbookIds: string[];
  webhookUrl: string | null;
  onCallUserIds: string[];
};

/**
 * Evaluate capacity-linked rules against a (optional precomputed) forecast.
 * Returns counts for observability/tests.
 */
export async function evaluateCapacityLinkedAlerts(
  rules: CapacityAlertRuleSlice[],
  options?: {
    forecast?: CapacityForecastResult;
    nowMs?: number;
    /** Injected for tests — skip silence window helper */
    isSilent?: (windows: string[]) => boolean;
  },
): Promise<{ evaluated: number; fired: number; resolved: number; skipped: number }> {
  const capacityRules = rules.filter((r) => r.enabled && isCapacityAlertMetric(r.metric));
  if (capacityRules.length === 0) {
    return { evaluated: 0, fired: 0, resolved: 0, skipped: 0 };
  }

  const { isNowInAlertSilenceWindow } = await import("./service-types");
  const isSilent =
    options?.isSilent ??
    ((windows: string[]) => isNowInAlertSilenceWindow(windows));

  const forecast =
    options?.forecast ??
    (await getCapacityForecast({
      windowHours: 168,
      horizonDays: 90,
      nowMs: options?.nowMs,
    }));

  let fired = 0;
  let resolved = 0;
  let skipped = 0;

  for (const rule of capacityRules) {
    if (isSilent(rule.silenceWindows)) {
      skipped += 1;
      continue;
    }

    const key = capacityMetricKeyFromAlertMetric(rule.metric as CapacityAlertMetric);
    const inCooldown =
      Boolean(rule.lastTriggeredAt) &&
      Date.now() - (rule.lastTriggeredAt as Date).getTime() < rule.cooldownMinutes * 60_000;

    const targets =
      rule.serverIds.length > 0
        ? forecast.servers.filter((s) => rule.serverIds.includes(s.serverId))
        : forecast.servers;

    for (const server of targets) {
      const { value, reason } = daysValueFromServerForecast(server, key);

      if (value === null) {
        // Recovered / not projected / insufficient — resolve any open incident.
        await resolveAlertIncident({
          ruleId: rule.id,
          serverId: server.serverId,
          metric: rule.metric,
          title: `Capacity forecast clear: ${server.serverName} ${key}`,
          message: `${rule.name}: ${rule.metric} no longer projects a breach (${reason})`,
          notifyChannels: rule.notifyChannels,
          webhookUrl: rule.webhookUrl,
          onCallUserIds: rule.onCallUserIds ?? [],
        });
        resolved += 1;
        continue;
      }

      const triggered = compare(rule.operator, value, rule.threshold);
      if (!triggered) {
        await resolveAlertIncident({
          ruleId: rule.id,
          serverId: server.serverId,
          metric: rule.metric,
          title: `Capacity forecast clear: ${server.serverName} ${key}`,
          message: `${rule.name}: days-to-85=${value} is outside ${rule.operator} ${rule.threshold}`,
          notifyChannels: rule.notifyChannels,
          webhookUrl: rule.webhookUrl,
          onCallUserIds: rule.onCallUserIds ?? [],
        });
        resolved += 1;
        continue;
      }

      if (inCooldown) {
        skipped += 1;
        continue;
      }

      const title = `Capacity risk: ${server.serverName} ${key} → 85%`;
      const message = `${rule.name}: projected ${value.toFixed(1)} day(s) until 85% ${key} usage (${rule.operator} ${rule.threshold})`;

      const fire = await openOrRefreshAlertIncident({
        ruleId: rule.id,
        ruleName: rule.name,
        serverId: server.serverId,
        serverName: server.serverName,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        value,
        notifyChannels: rule.notifyChannels,
        webhookUrl: rule.webhookUrl,
        onCallUserIds: rule.onCallUserIds ?? [],
        title,
        message,
      });

      if (fire.notified) {
        fired += 1;
        const now = new Date();
        for (const playbookId of rule.playbookIds ?? []) {
          try {
            await runPlaybook({
              playbookId,
              dryRun: false,
              triggerContext: {
                type: "capacity_forecast",
                alertRuleId: rule.id,
                alertRuleName: rule.name,
                serverId: server.serverId,
                serverName: server.serverName,
                metric: rule.metric,
                operator: rule.operator,
                threshold: rule.threshold,
                value,
                triggeredAt: now.toISOString(),
                incidentId: fire.incidentId,
              },
            });
          } catch (error) {
            logger.warn("capacity-linked playbook failed", {
              playbookId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggeredAt: now, lastMatchedAt: now },
        });
      }
    }
  }

  return {
    evaluated: capacityRules.length,
    fired,
    resolved,
    skipped,
  };
}
