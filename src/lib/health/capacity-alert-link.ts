import type { SamplingClaim } from "@/lib/monitoring/sampling-claim";
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
import { parseAlertMatchState, persistMatchState } from "./alert-match-state";
import { prisma } from "@/lib/db";
import {
  openOrRefreshAlertIncident,
  resolveAlertIncident,
} from "@/lib/alert/incidents";
import { liveCustomerRowsWhere, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { alertOperatorSign } from "@/lib/alert/operator";
import { t } from "@/lib/i18n/service-translations";
import { getCapacityForecast, type CapacityForecastResult } from "./capacity-service";
import type { CapacityMetricKey, ServerCapacityForecast } from "./capacity-predict";

/**
 * The 7-day × 720-bucket fleet forecast is far too heavy to recompute on the
 * alert worker's one-minute tick (A2-11); a forecast serves 15 minutes. Tests
 * and callers that pin `nowMs` bypass the cache.
 */
const CAPACITY_FORECAST_CACHE_MS = 15 * 60_000;
let capacityForecastCache: { at: number; value: ReturnType<typeof getCapacityForecast> } | null = null;

/** Tests evaluate several fleets in one process; production never needs this. */
export function resetCapacityForecastCache() {
  capacityForecastCache = null;
}

function readCapacityForecastCached(nowMs?: number, session?: TeamSession) {
  if (nowMs !== undefined || session) return getCapacityForecast({ windowHours: 168, horizonDays: 90, nowMs, session });
  const now = Date.now();
  if (capacityForecastCache && now - capacityForecastCache.at < CAPACITY_FORECAST_CACHE_MS) return capacityForecastCache.value;
  const value = getCapacityForecast({ windowHours: 168, horizonDays: 90 });
  capacityForecastCache = { at: now, value };
  value.catch(() => { capacityForecastCache = null; });
  return value;
}

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
  durationSeconds: number;
  matchState: unknown;
  updatedAt: Date;
  version?: string;
  lastMatchedAt: Date | null;
  lastTriggeredAt: Date | null;
  cooldownMinutes: number;
  silenceWindows: string[];
  serverIds: string[];
  notifyChannels: string[];
  playbookIds: string[];
  webhookUrl: string | null;
  onCallUserIds: string[];
  /** The rule's own escalation delay (null: the platform default). */
  escalationMinutes?: number | null;
  teamId?: string | null;
};

/**
 * Evaluate capacity-linked rules against a (optional precomputed) forecast.
 * Returns counts for observability/tests.
 */
export async function evaluateCapacityLinkedAlerts(
  rules: CapacityAlertRuleSlice[],
  options?: {
    forecast?: CapacityForecastResult;
    session?: TeamSession;
    claim?: SamplingClaim;
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
    (await readCapacityForecastCached(options?.nowMs, options?.session));

  let fired = 0;
  let resolved = 0;
  let skipped = 0;

  for (const rule of capacityRules) {
    options?.claim?.signal.throwIfAborted();
    if (isSilent(rule.silenceWindows)) {
      skipped += 1;
      continue;
    }

    const key = capacityMetricKeyFromAlertMetric(rule.metric as CapacityAlertMetric);
    // Rule-level lastTriggeredAt is only a UI stamp. Do NOT use it as a
    // multi-host cooldown gate: after host A fires, host B must still open
    // its own incident. Spam prevention is per-fingerprint inside
    // openOrRefreshAlertIncident (notified=false while OPEN/ACKNOWLEDGED).
    const ruleCooldownActive =
      Boolean(rule.lastTriggeredAt) &&
      Date.now() - (rule.lastTriggeredAt as Date).getTime() < rule.cooldownMinutes * 60_000;

    let targets =
      rule.serverIds.length > 0
        ? forecast.servers.filter((s) => rule.serverIds.includes(s.serverId))
        : forecast.servers;
    const allowed = new Set<string>();
    const candidates = targets.map((server) => server.serverId);
    for (let offset = 0; offset < candidates.length; offset += 500) {
      options?.claim?.signal.throwIfAborted();
      const live = await prisma.server.findMany({
        where: {
          id: { in: candidates.slice(offset, offset + 500) }, enabled: true,
          ...(rule.teamId == null ? {} : { teamId: rule.teamId }), ...liveCustomerRowsWhere(),
          ...(options?.session ? { AND: [serverTeamWhere(options.session)] } : {}),
        },
        select: { id: true },
      });
      for (const server of live) allowed.add(server.id);
    }
    targets = targets.filter((server) => allowed.has(server.serverId));

    const matchState = parseAlertMatchState(rule.matchState);
    const now = new Date(options?.nowMs ?? Date.now());
    let stateChanged = false;
    if (forecast.servers.length > 0 && !options?.session) {
      const targetIds = new Set(targets.map((server) => server.serverId));
      for (const id of Object.keys(matchState)) {
        if (!targetIds.has(id)) {
          delete matchState[id];
          stateChanged = true;
        }
      }
    }
    let latestFireAt: Date | null = null;

    for (const server of targets) {
      options?.claim?.signal.throwIfAborted();
      const evaluation = rule.version ? { version: rule.version, sampledAt: new Date(forecast.summary.generatedAt), claim: options?.claim } : undefined;
      if (isSilent(rule.silenceWindows)) break;
      const { value, reason } = daysValueFromServerForecast(server, key);

      const matches = value !== null && compare(rule.operator, value, rule.threshold);
      if (!matches && matchState[server.serverId]) {
        delete matchState[server.serverId];
        stateChanged = true;
      }
      if (value === null && (reason === "insufficient_data" || reason === "metric_missing")) {
        // Unknown is not recovered: missing history (a sampling gap, a
        // restart) must not clear an open capacity incident.
        continue;
      }
      if (value === null) {
        // Recovered / not projected — resolve any open incident.
        const cleared = await resolveAlertIncident({
          ruleId: rule.id, evaluation,
          silenceWindows: rule.silenceWindows,
          ruleName: rule.name,
          serverId: server.serverId,
          metric: rule.metric,
          title: t("backend.alert.capacity.clearTitle", { server: server.serverName, key }),
          message: t("backend.alert.capacity.clearMessage", { rule: rule.name, metric: rule.metric, reason }),
          notifyChannels: rule.notifyChannels,
          webhookUrl: rule.webhookUrl,
          onCallUserIds: rule.onCallUserIds ?? [],
          teamId: rule.teamId ?? null,
        });
        if (cleared.resolved) resolved += 1;
        continue;
      }

      if (!matches) {
        const cleared = await resolveAlertIncident({
          ruleId: rule.id, evaluation,
          silenceWindows: rule.silenceWindows,
          ruleName: rule.name,
          serverId: server.serverId,
          metric: rule.metric,
          title: t("backend.alert.capacity.clearTitle", { server: server.serverName, key }),
          message: t("backend.alert.capacity.clearMessageOutside", { rule: rule.name, value, operator: alertOperatorSign(rule.operator), threshold: rule.threshold }),
          notifyChannels: rule.notifyChannels,
          webhookUrl: rule.webhookUrl,
          onCallUserIds: rule.onCallUserIds ?? [],
          teamId: rule.teamId ?? null,
        });
        if (cleared.resolved) resolved += 1;
        continue;
      }

      if (rule.durationSeconds > 0) {
        const started = matchState[server.serverId];
        if (!started) {
          matchState[server.serverId] = now.toISOString();
          stateChanged = true;
          continue;
        }
        if (now.getTime() - Date.parse(started) < rule.durationSeconds * 1000) continue;
      }

      const title = t("backend.alert.capacity.riskTitle", { server: server.serverName, key });
      const message = t("backend.alert.capacity.riskMessage", { rule: rule.name, value: value.toFixed(1), key, operator: alertOperatorSign(rule.operator), threshold: rule.threshold });

      const fire = await openOrRefreshAlertIncident({
        ruleId: rule.id, evaluation,
        playbookIds: rule.playbookIds,
        silenceWindows: rule.silenceWindows,
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
        teamId: rule.teamId ?? null,
        cooldownMinutes: rule.cooldownMinutes,
        escalationMinutes: rule.escalationMinutes ?? undefined,
      });

      if (!fire.fired) {
        // Existing OPEN incident refresh, cooldown-suppressed, or raced — not a
        // fresh fire. Gate on `fired` (not `notified`) so a best-effort delivery
        // failure still counts as a fire and stamps lastTriggeredAt / automates.
        if (ruleCooldownActive) skipped += 1;
        continue;
      }

      fired += 1;
      matchState[server.serverId] ??= now.toISOString();
      latestFireAt = now;
    }

    if (stateChanged || latestFireAt) {
      await persistMatchState(rule, matchState, latestFireAt ? { lastTriggeredAt: latestFireAt } : {}, options?.claim);
    }
  }

  return {
    evaluated: capacityRules.length,
    fired,
    resolved,
    skipped,
  };
}
