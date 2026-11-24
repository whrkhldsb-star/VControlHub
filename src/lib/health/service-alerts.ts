/**
 * Health service — alert evaluation + notification dispatch
 * (R28 god-file split).
 *
 * `evaluateAlerts` reads enabled alert rules, fetches the current
 * `HealthOverview` (via the collector in `./service-collect`), filters
 * by silence-window / cooldown / duration, opens AlertIncident records,
 * routes on-call users, and escalates unacknowledged incidents.
 *
 * Duration tracking is **per server** via `AlertRule.matchState`
 * (`{ [serverId]: ISO timestamp }`). A single global `lastMatchedAt`
 * would skip duration or clear pending state across unrelated hosts.
 */
import { prisma } from "@/lib/db";
import { liveCustomerRowsWhere, type TeamSession } from "@/lib/auth/team-scope";
import type { SamplingClaim } from "@/lib/monitoring/sampling-claim";
import { configurationDigest, verifiedRuleChannels } from "@/lib/alert/channel-grants";
import {
  buildAlertFingerprint,
  escalateOverdueAlertIncidents,
  openOrRefreshAlertIncident,
  resolveAlertIncident,
} from "@/lib/alert/incidents";
import { alertOperatorSign } from "@/lib/alert/operator";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";

const alertEvalLogger = createLogger("health:alerts");

import { LEGACY_MATCH_KEY, parseAlertMatchState, matchStartedAtForServer, persistMatchState } from "./alert-match-state";
import { collectAllHealth } from "./service-collect";
import { sampledEndpoint } from "./sample-binding";
import { isNowInAlertSilenceWindow } from "./service-types";
import {
  evaluateCapacityLinkedAlerts,
  isCapacityAlertMetric,
} from "./capacity-alert-link";

export { parseAlertMatchState, matchStartedAtForServer, type AlertMatchState } from "./alert-match-state";

/** Render metric names in the notification language. */
function alertMetricLabel(metric: string): string {
  const key = `backend.metric.${metric}`;
  const label = t(key);
  return label === key ? metric.replace("_", " ") : label;
}

/**
 * Evaluate alert rules against current fleet health.
 *
 * Called two ways:
 *  - background worker / AI ops with no argument → fleet-wide (every tenant).
 *  - a manual "evaluate now" trigger passes `ruleWhere` (a `teamWhere(session)`
 *    fragment) so a team operator only evaluates their own rules and never
 *    opens/escalates/notifies — or runs playbooks against — other tenants' hosts.
 */
export async function evaluateAlerts(options?: { ruleWhere?: Record<string, unknown>; session?: TeamSession; claim?: SamplingClaim }) {
  // Fleet-wide passes cover platform rules and live customers' rules: a
  // deleted customer's rules would keep notifying its channels (and starting
  // its playbooks) and its open incidents kept escalating after removal.
  const ruleScope = options?.ruleWhere ? { AND: [liveCustomerRowsWhere(), options.ruleWhere] } : liveCustomerRowsWhere();
  const escalateOptions = { ruleTeamWhere: options?.ruleWhere, claim: options?.claim };
  const rules = [];
  let ruleCursorId: string | undefined;
  for (;;) {
    options?.claim?.signal.throwIfAborted();
    const page = await prisma.alertRule.findMany({
      where: { enabled: true, ...ruleScope },
      select: {
        id: true,
        name: true,
        metric: true,
        threshold: true,
        operator: true,
        durationSeconds: true,
        enabled: true,
        lastMatchedAt: true,
        matchState: true,
        lastTriggeredAt: true,
        cooldownMinutes: true,
        silenceWindows: true,
        serverIds: true,
        notifyChannels: true,
        playbookIds: true,
        webhookUrl: true,
        escalationMinutes: true,
        onCallUserIds: true,
        teamId: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
      take: 200,
      ...(ruleCursorId ? { cursor: { id: ruleCursorId }, skip: 1 } : {}),
    });
    for (const rule of page) rules.push({ ...rule, version: configurationDigest(rule), notifyChannels: await verifiedRuleChannels(rule) });
    if (page.length < 200) break;
    ruleCursorId = page[page.length - 1]!.id;
  }
  if (rules.length === 0) {
    await escalateOverdueAlertIncidents(escalateOptions);
    return;
  }

  // Optional capacity-forecast rules (threshold = days until projected 85%).
  const capacityRules = rules.filter((r) => isCapacityAlertMetric(r.metric));
  const liveRules = rules.filter((r) => !isCapacityAlertMetric(r.metric));
  if (capacityRules.length > 0) {
    await evaluateCapacityLinkedAlerts(capacityRules, { session: options?.session, claim: options?.claim });
  }

  if (!liveRules.length) {
    await escalateOverdueAlertIncidents(escalateOptions);
    return;
  }
  const targets = liveRules.map((rule) => ({
    ...(rule.teamId ? { teamId: rule.teamId } : {}),
    ...(rule.serverIds.length ? { id: { in: rule.serverIds } } : {}),
  }));
  const health = await collectAllHealth(options?.session, {
    claim: options?.claim, serverWhere: { enabled: true, ...(targets.some((scope) => !Object.keys(scope).length) ? {} : { OR: targets }) },
  });
  // Incidents still open for these rules. Recovery used to be read from the
  // rule's per-server match stamp alone: a stamp lost to a concurrent
  // evaluation (its write is a compare-and-set) or cleared by an edit of the
  // rule left the incident open for good, with nothing to close it.
  const openFingerprints = new Set(
    (await prisma.alertIncident.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, serverId: { not: null }, rule: { enabled: true, ...ruleScope } },
      select: { fingerprint: true },
    })).map((incident) => incident.fingerprint),
  );
  // Cache server ownership for both explicit targets and whole-customer rules.
  const teamServerIdsCache = new Map<string, Set<string>>();
  async function serverIdsForTeam(teamId: string): Promise<Set<string>> {
    const hit = teamServerIdsCache.get(teamId);
    if (hit) return hit;
    const rows: Array<{ id: string }> = [];
    let serverCursor: { id: string } | undefined;
    do {
      options?.claim?.signal.throwIfAborted();
      const page = await prisma.server.findMany({
        where: { teamId },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 500,
        ...(serverCursor ? { cursor: serverCursor, skip: 1 } : {}),
      });
      rows.push(...page);
      serverCursor = page.length === 500 ? { id: page[page.length - 1]!.id } : undefined;
    } while (serverCursor);
    const set = new Set(rows.map((r) => r.id));
    teamServerIdsCache.set(teamId, set);
    return set;
  }

  for (const rule of liveRules) {
    options?.claim?.signal.throwIfAborted();
    if (isNowInAlertSilenceWindow(rule.silenceWindows)) continue;

    try {
    let targetServers =
      rule.serverIds.length > 0
        ? health.servers.filter((s) => rule.serverIds.includes(s.serverId))
        : health.servers.filter((s) => s.enabled);
    if (rule.teamId != null) {
      const allowed = await serverIdsForTeam(rule.teamId);
      targetServers = targetServers.filter((s) => allowed.has(s.serverId) && (s.sampledTeamId === undefined || s.sampledTeamId === rule.teamId));
    }

    // Working copy of per-server match state for this rule evaluation pass.
    let matchState = parseAlertMatchState(rule.matchState);
    // Migrate one-shot from legacy lastMatchedAt when matchState is empty.
    if (Object.keys(matchState).length === 0 && rule.lastMatchedAt) {
      matchState = {
        [LEGACY_MATCH_KEY]: rule.lastMatchedAt.toISOString(),
      };
    }
    let matchStateDirty = false;
    let ruleFiredThisPass = false;
    let latestFireAt: Date | null = null;

    for (const server of targetServers) {
      options?.claim?.signal.throwIfAborted();
      const evaluation = { version: rule.version, sampledAt: new Date(server.lastCheck), claim: options?.claim, [sampledEndpoint]: server[sampledEndpoint] };
      if (isNowInAlertSilenceWindow(rule.silenceWindows)) break;
      let value: number | undefined;
      switch (rule.metric) {
        case "cpu_usage":
          value = server.cpu;
          break;
        case "mem_usage":
          value = server.mem;
          break;
        case "disk_usage":
          value = server.diskMax;
          break;
        case "server_offline":
          // A disabled host is intentionally unmonitored — collectAllHealth
          // reports it as status "offline" for the dashboard chip, but that is
          // an administrative state, not a network outage. Treating it as a
          // match here would fire a false "offline" alert on disable and a
          // false "back online" resolution on re-enable. Every other metric is
          // already immune (disabled hosts carry undefined cpu/mem → skipped);
          // this is the only metric that derives its value from `status`.
          value = server.enabled
            ? server.status === "offline"
              ? 1
              : 0
            : undefined;
          break;
        case "network_in":
          value = server.networkInKbps;
          break;
        case "network_out":
          value = server.networkOutKbps;
          break;
        case "load_avg":
          value = server.loadAvg1m;
          break;
        case "swap_usage":
          value = server.swapUsagePercent;
          break;
      }

      if (value === undefined || !Number.isFinite(value)) continue;

      let triggered = false;
      switch (rule.operator) {
        case "gt":
          triggered = value > rule.threshold;
          break;
        case "gte":
          triggered = value >= rule.threshold;
          break;
        case "lt":
          triggered = value < rule.threshold;
          break;
        case "lte":
          triggered = value <= rule.threshold;
          break;
        case "eq":
          triggered = value === rule.threshold;
          break;
      }

      if (!triggered) {
        // Only this server's key (or one-shot legacy stamp) counts as a prior
        // match. Global rule.lastMatchedAt must NOT force resolve/clear for
        // hosts that never entered the duration window.
        const hadMatch =
          Boolean(matchState[server.serverId]) ||
          Boolean(matchState[LEGACY_MATCH_KEY]) ||
          openFingerprints.has(buildAlertFingerprint(rule.id, server.serverId, rule.metric));
        if (hadMatch) {
          const resolvedTitle = rule.metric === "server_offline"
            ? t("backend.alert.resolvedTitle.offline", { server: server.serverName })
            : t("backend.alert.resolvedTitle.metric", { server: server.serverName, metric: alertMetricLabel(rule.metric) });
          const resolvedMessage =
            rule.metric === "server_offline"
              ? t("backend.alert.resolvedMessage.offline", { rule: rule.name, server: server.serverName })
              : t("backend.alert.resolvedMessage.metric", { rule: rule.name, metric: alertMetricLabel(rule.metric), operator: alertOperatorSign(rule.operator), threshold: rule.threshold });
          await resolveAlertIncident({
            ruleId: rule.id, evaluation,
            silenceWindows: rule.silenceWindows,
            ruleName: rule.name,
            serverId: server.serverId,
            metric: rule.metric,
            title: resolvedTitle,
            message: resolvedMessage,
            notifyChannels: rule.notifyChannels,
            webhookUrl: rule.webhookUrl,
            onCallUserIds: rule.onCallUserIds ?? [],
            teamId: rule.teamId ?? null,
          });
          if (matchState[server.serverId]) {
            delete matchState[server.serverId];
            matchStateDirty = true;
          }
          // Legacy global stamp applies at most once; clear after first host recovery.
          if (matchState[LEGACY_MATCH_KEY]) {
            delete matchState[LEGACY_MATCH_KEY];
            matchStateDirty = true;
          }
        }
        continue;
      }

      const now = new Date();
      if (rule.durationSeconds > 0 && !openFingerprints.has(buildAlertFingerprint(rule.id, server.serverId, rule.metric))) {
        const started = matchStartedAtForServer(matchState, server.serverId);
        if (!started) {
          matchState[server.serverId] = now.toISOString();
          delete matchState[LEGACY_MATCH_KEY];
          matchStateDirty = true;
          continue;
        }
        const matchedForMs = now.getTime() - started.getTime();
        if (matchedForMs < rule.durationSeconds * 1000) continue;
      }

      // Do not gate multi-host fires on rule.lastTriggeredAt — that stamp is
      // fleet-wide and would suppress host B after host A notified. Per-host
      // spam control lives in openOrRefreshAlertIncident (notified=false while
      // OPEN/ACKNOWLEDGED). Escalation of open incidents is handled separately.

      const title = rule.metric === "server_offline"
        ? t("backend.alert.title.offline", { server: server.serverName })
        : t("backend.alert.title.metric", { server: server.serverName, metric: alertMetricLabel(rule.metric) });
      const message = t("backend.alert.message.metric", { rule: rule.name, metric: alertMetricLabel(rule.metric), operator: alertOperatorSign(rule.operator), threshold: rule.threshold, value });

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

      // The opening already queued any remediation. Stamp it even if delivery failed.
      if (fire.fired) {
        ruleFiredThisPass = true;
        latestFireAt = now;
      }

      // Keep the original crossing even when a notification is retried.
      const started = matchStartedAtForServer(matchState, server.serverId);
      if (!matchState[server.serverId]) {
        matchState[server.serverId] = (started ?? now).toISOString();
        delete matchState[LEGACY_MATCH_KEY];
        matchStateDirty = true;
      }
    }

    // Prune match stamps for servers that have left this rule's scope —
    // deleted, disabled, removed from serverIds, or moved to another team.
    // Their recovery branch never runs (they are no longer iterated), so
    // without this the matchState JSON accretes dead serverId keys forever,
    // and re-adding the same server later would inherit a stale match-start
    // and skip its duration window. Guard on a non-empty fleet snapshot so a
    // transient empty collectAllHealth() does not wipe in-progress timers.
    if (health.servers.length > 0 && !options?.session) {
      const targetIds = new Set(targetServers.map((s) => s.serverId));
      for (const key of Object.keys(matchState)) {
        if (key === LEGACY_MATCH_KEY) continue;
        if (!targetIds.has(key)) {
          delete matchState[key];
          matchStateDirty = true;
        }
      }
    }

    if (matchStateDirty || ruleFiredThisPass) {
      await persistMatchState(
        rule,
        matchState,
        ruleFiredThisPass && latestFireAt
          ? { lastTriggeredAt: latestFireAt }
          : {}, options?.claim,
      );
    }
    } catch (error) {
      if (options?.claim?.signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "SamplingClaimLostError"))) {
        throw error;
      }
      alertEvalLogger.error("alert rule evaluation failed; continuing with remaining rules", error, {
        ruleId: rule.id,
        teamId: rule.teamId,
      });
    }
  }

  await escalateOverdueAlertIncidents(escalateOptions);
}
