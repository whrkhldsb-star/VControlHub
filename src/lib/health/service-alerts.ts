/**
 * Health service — alert evaluation + notification dispatch
 * (R28 god-file split).
 *
 * `evaluateAlerts` reads enabled alert rules, fetches the current
 * `HealthOverview` (via the collector in `./service-collect`), filters
 * by silence-window / cooldown / duration, opens AlertIncident records,
 * routes on-call users, and escalates unacknowledged incidents.
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

export async function evaluateAlerts() {
  const rules = await prisma.alertRule.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      metric: true,
      threshold: true,
      operator: true,
      durationSeconds: true,
      enabled: true,
      lastMatchedAt: true,
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
    take: 200,
  });
  if (rules.length === 0) {
    await escalateOverdueAlertIncidents();
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
    const rows = await prisma.server.findMany({
      where: { teamId },
      select: { id: true },
      take: 5000,
    });
    const set = new Set(rows.map((r) => r.id));
    teamServerIdsCache.set(teamId, set);
    return set;
  }

  for (const rule of liveRules) {
    if (isNowInAlertSilenceWindow(rule.silenceWindows)) continue;

    // Check cooldown (still applies to new fire spam; open incidents escalate separately)
    if (rule.lastTriggeredAt) {
      const cooldownMs = rule.cooldownMinutes * 60_000;
      if (Date.now() - rule.lastTriggeredAt.getTime() < cooldownMs) {
        // Still process resolves below for servers that recovered; only skip new fires.
        // We continue per-server with a flag instead of skipping the whole rule.
      }
    }

    const inCooldown =
      Boolean(rule.lastTriggeredAt) &&
      Date.now() - (rule.lastTriggeredAt as Date).getTime() < rule.cooldownMinutes * 60_000;

    let targetServers =
      rule.serverIds.length > 0
        ? health.servers.filter((s) => rule.serverIds.includes(s.serverId))
        : health.servers.filter((s) => s.enabled);
    // Team-scoped rules with empty serverIds must not watch other teams' hosts.
    if (rule.serverIds.length === 0 && rule.teamId) {
      const allowed = await serverIdsForTeam(rule.teamId);
      targetServers = targetServers.filter((s) => allowed.has(s.serverId));
    }

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
          value = server.status === "offline" ? 1 : 0;
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
        if (rule.lastMatchedAt) {
          const resolvedTitle = `Alert resolved: ${server.serverName} ${rule.metric === "server_offline" ? "back online" : rule.metric.replace("_", " ")}`;
          const resolvedMessage = `${rule.name}: ${rule.metric} has returned to normal range (threshold ${rule.operator} ${rule.threshold})`;
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
          await prisma.alertRule.update({
            where: { id: rule.id },
            data: { lastMatchedAt: null },
          });
        }
        continue;
      }

      const now = new Date();
      if (rule.durationSeconds > 0) {
        if (!rule.lastMatchedAt) {
          await prisma.alertRule.update({
            where: { id: rule.id },
            data: { lastMatchedAt: now },
          });
          continue;
        }
        const matchedForMs = now.getTime() - rule.lastMatchedAt.getTime();
        if (matchedForMs < rule.durationSeconds * 1000) continue;
      }

      // Cooldown still blocks brand-new fires; open incidents escalate via worker separately.
      if (inCooldown) continue;

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
      });

      if (fire.notified) {
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

      await prisma.alertRule.update({
        where: { id: rule.id },
        data: { lastTriggeredAt: now, lastMatchedAt: now },
      });
    }
  }

  await escalateOverdueAlertIncidents();
}
