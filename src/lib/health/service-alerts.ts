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
import {
  escalateOverdueAlertIncidents,
  openOrRefreshAlertIncident,
  resolveAlertIncident,
} from "@/lib/alert/incidents";
import { runPlaybook } from "@/lib/playbook/service";

import { collectAllHealth } from "./service-collect";
import { isNowInAlertSilenceWindow } from "./service-types";
import {
  evaluateCapacityLinkedAlerts,
  isCapacityAlertMetric,
} from "./capacity-alert-link";

/** serverId → ISO match-start timestamp */
export type AlertMatchState = Record<string, string>;

const LEGACY_MATCH_KEY = "_legacy";

export function parseAlertMatchState(raw: unknown): AlertMatchState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AlertMatchState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) out[key] = new Date(ms).toISOString();
    }
  }
  return out;
}

export function matchStartedAtForServer(
  state: AlertMatchState,
  serverId: string,
): Date | null {
  const iso = state[serverId] ?? state[LEGACY_MATCH_KEY];
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function deriveLegacyLastMatchedAt(state: AlertMatchState): Date | null {
  let latest: Date | null = null;
  for (const [key, iso] of Object.entries(state)) {
    if (key === LEGACY_MATCH_KEY) continue;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

async function persistMatchState(
  ruleId: string,
  state: AlertMatchState,
  extra: { lastTriggeredAt?: Date } = {},
) {
  const cleaned: AlertMatchState = { ...state };
  delete cleaned[LEGACY_MATCH_KEY];
  await prisma.alertRule.update({
    where: { id: ruleId },
    data: {
      matchState: cleaned,
      lastMatchedAt: deriveLegacyLastMatchedAt(cleaned),
      ...extra,
    },
  });
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
export async function evaluateAlerts(options?: { ruleWhere?: Record<string, unknown> }) {
  const ruleScope = options?.ruleWhere ?? {};
  const escalateOptions = Object.keys(ruleScope).length > 0 ? { ruleTeamWhere: ruleScope } : undefined;
  const rules = [];
  let ruleCursorId: string | undefined;
  for (;;) {
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
      },
      orderBy: { id: "asc" },
      take: 200,
      ...(ruleCursorId ? { cursor: { id: ruleCursorId }, skip: 1 } : {}),
    });
    rules.push(...page);
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
    await evaluateCapacityLinkedAlerts(capacityRules);
  }

  const health = await collectAllHealth();
  // Cache team → server ids so empty serverIds rules only cover their team.
  const teamServerIdsCache = new Map<string, Set<string>>();
  async function serverIdsForTeam(teamId: string): Promise<Set<string>> {
    const hit = teamServerIdsCache.get(teamId);
    if (hit) return hit;
    const rows: Array<{ id: string }> = [];
    let serverCursor: { id: string } | undefined;
    do {
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
    if (isNowInAlertSilenceWindow(rule.silenceWindows)) continue;

    let targetServers =
      rule.serverIds.length > 0
        ? health.servers.filter((s) => rule.serverIds.includes(s.serverId))
        : health.servers.filter((s) => s.enabled);
    // Team-scoped rules with empty serverIds must not watch other teams' hosts.
    if (rule.serverIds.length === 0 && rule.teamId) {
      const allowed = await serverIdsForTeam(rule.teamId);
      targetServers = targetServers.filter((s) => allowed.has(s.serverId));
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

      if (value === undefined) continue;

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
          Boolean(matchState[LEGACY_MATCH_KEY]);
        if (hadMatch) {
          const resolvedTitle = `Alert resolved: ${server.serverName} ${rule.metric === "server_offline" ? "back online" : rule.metric.replace("_", " ")}`;
          const resolvedMessage =
            rule.metric === "server_offline"
              ? `${rule.name}: ${server.serverName} is reachable again`
              : `${rule.name}: ${rule.metric} has returned to normal range (threshold ${rule.operator} ${rule.threshold})`;
          await resolveAlertIncident({
            ruleId: rule.id,
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
      if (rule.durationSeconds > 0) {
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

      const title = `Alert: ${server.serverName} ${rule.metric === "server_offline" ? "offline" : rule.metric.replace("_", " ")}`;
      const message = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (current: ${value})`;

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
        teamId: rule.teamId ?? null,
        cooldownMinutes: rule.cooldownMinutes,
      });

      // Stamp lastTriggeredAt and run remediation on a fresh fire regardless of
      // delivery outcome. `notified` reflects only whether a human was paged;
      // best-effort delivery failure must not lose the trigger record or skip
      // automation. Per-host notify spam control lives in the incident layer.
      if (fire.fired) {
        ruleFiredThisPass = true;
        latestFireAt = now;
        for (const playbookId of rule.playbookIds ?? []) {
          try {
            await runPlaybook({
              playbookId,
              dryRun: false,
              triggerContext: {
                type: "alert_rule",
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
          } catch {
            /* playbook automation is best-effort */
          }
        }
      }

      // Keep this server's match stamp so recovery can clear it later.
      matchState[server.serverId] = now.toISOString();
      delete matchState[LEGACY_MATCH_KEY];
      matchStateDirty = true;
    }

    // Prune match stamps for servers that have left this rule's scope —
    // deleted, disabled, removed from serverIds, or moved to another team.
    // Their recovery branch never runs (they are no longer iterated), so
    // without this the matchState JSON accretes dead serverId keys forever,
    // and re-adding the same server later would inherit a stale match-start
    // and skip its duration window. Guard on a non-empty fleet snapshot so a
    // transient empty collectAllHealth() does not wipe in-progress timers.
    if (health.servers.length > 0) {
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
        rule.id,
        matchState,
        ruleFiredThisPass && latestFireAt
          ? { lastTriggeredAt: latestFireAt }
          : {},
      );
    }
  }

  await escalateOverdueAlertIncidents(escalateOptions);
}
