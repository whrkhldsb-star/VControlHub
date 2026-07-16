/**
 * Alert incidents — multi-level escalation, on-call routing, acknowledgement.
 *
 * Lifecycle:
 *   OPEN (level 1 fire) → ACKNOWLEDGED (human confirm)
 *                       → OPEN level 2+ (escalation after N minutes without ack)
 *                       → RESOLVED (metric recovered)
 *
 * On-call users (rule.onCallUserIds) receive in-app first; empty = notification:manage admins.
 */
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { createNotification, type NotificationType } from "@/lib/notification/service";
import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

const logger = createLogger("alert:incidents");

export type AlertFireInput = {
  ruleId: string;
  ruleName: string;
  serverId: string | null;
  serverName: string;
  metric: string;
  operator: string;
  threshold: number;
  value: number;
  notifyChannels: string[];
  webhookUrl?: string | null;
  onCallUserIds?: string[];
  title: string;
  message: string;
};

export function buildAlertFingerprint(ruleId: string, serverId: string | null, metric: string): string {
  return `${ruleId}::${serverId ?? "fleet"}::${metric}`;
}

async function resolveNotifyUserIds(onCallUserIds: string[] | undefined): Promise<string[]> {
  const preferred = (onCallUserIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (preferred.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: preferred }, status: { not: "DISABLED" } },
      select: { id: true },
      take: 50,
    });
    if (users.length > 0) return users.map((u) => u.id);
  }
  const admins = await prisma.user.findMany({
    where: {
      roles: {
        some: {
          role: {
            permissions: {
              some: { permission: { key: "notification:manage" } },
            },
          },
        },
      },
    },
    select: { id: true },
    take: 100,
  });
  return admins.map((u) => u.id);
}

async function dispatchChannels(input: {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  actionUrl: string;
  notifyChannels: string[];
  webhookUrl?: string | null;
  contextLines: string[];
  level: number;
}) {
  if (input.notifyChannels.includes("in_app")) {
    await Promise.allSettled(
      input.userIds.map((userId) =>
        createNotification({
          userId,
          type: input.type,
          title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
          message: input.message,
          actionUrl: input.actionUrl,
        }),
      ),
    );
  }

  if (input.notifyChannels.includes("webhook") && input.webhookUrl) {
    try {
      const delivery = await fetchWebhookSafely(input.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          message: input.message,
          level: input.level,
          timestamp: new Date().toISOString(),
          context: input.contextLines,
        }),
      });
      if (!delivery.ok) throw new Error(delivery.error);
      if (!delivery.response.ok) throw new Error(`HTTP ${delivery.response.status}`);
    } catch (error) {
      logger.warn("alert webhook delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.notifyChannels.includes("email")) {
    try {
      await sendAlertEmail({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
    } catch (error) {
      logger.warn("alert email delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.notifyChannels.includes("telegram")) {
    try {
      await sendAlertTelegram({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
    } catch (error) {
      logger.warn("alert telegram delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Create or refresh an OPEN incident and send level-1 notifications.
 * Re-firing while OPEN/ACKNOWLEDGED only updates value; does not spam unless escalated.
 */
export async function openOrRefreshAlertIncident(input: AlertFireInput): Promise<{
  incidentId: string;
  created: boolean;
  notified: boolean;
  level: number;
}> {
  const fingerprint = buildAlertFingerprint(input.ruleId, input.serverId, input.metric);
  const existing = await prisma.alertIncident.findUnique({ where: { fingerprint } });
  const now = new Date();

  if (existing && (existing.status === "OPEN" || existing.status === "ACKNOWLEDGED")) {
    await prisma.alertIncident.update({
      where: { id: existing.id },
      data: {
        value: input.value,
        title: input.title,
        message: input.message,
        serverName: input.serverName,
      },
    });
    return {
      incidentId: existing.id,
      created: false,
      notified: false,
      level: existing.level,
    };
  }

  const incident = existing
    ? await prisma.alertIncident.update({
        where: { id: existing.id },
        data: {
          status: "OPEN",
          level: 1,
          value: input.value,
          title: input.title,
          message: input.message,
          serverName: input.serverName,
          acknowledgedAt: null,
          acknowledgedById: null,
          escalatedAt: null,
          resolvedAt: null,
          lastNotifiedAt: now,
        },
      })
    : await prisma.alertIncident.create({
        data: {
          fingerprint,
          ruleId: input.ruleId,
          serverId: input.serverId,
          serverName: input.serverName,
          metric: input.metric,
          operator: input.operator,
          threshold: input.threshold,
          value: input.value,
          status: "OPEN",
          level: 1,
          title: input.title,
          message: input.message,
          lastNotifiedAt: now,
        },
      });

  const userIds = await resolveNotifyUserIds(input.onCallUserIds);
  await dispatchChannels({
    userIds,
    type: "server_alert",
    title: input.title,
    message: input.message,
    actionUrl: `/alert-rules?incident=${incident.id}`,
    notifyChannels: input.notifyChannels,
    webhookUrl: input.webhookUrl,
    contextLines: [
      `Server: ${input.serverName}`,
      `Metric: ${input.metric}`,
      `Current: ${input.value}`,
      `Threshold: ${input.operator} ${input.threshold}`,
      `Level: 1`,
      `Incident: ${incident.id}`,
    ],
    level: 1,
  });

  return { incidentId: incident.id, created: !existing, notified: true, level: 1 };
}

export async function resolveAlertIncident(input: {
  ruleId: string;
  serverId: string | null;
  metric: string;
  title: string;
  message: string;
  notifyChannels: string[];
  webhookUrl?: string | null;
  onCallUserIds?: string[];
}): Promise<{ resolved: boolean; incidentId?: string }> {
  const fingerprint = buildAlertFingerprint(input.ruleId, input.serverId, input.metric);
  const existing = await prisma.alertIncident.findUnique({ where: { fingerprint } });
  if (!existing || existing.status === "RESOLVED") {
    return { resolved: false };
  }

  const now = new Date();
  await prisma.alertIncident.update({
    where: { id: existing.id },
    data: { status: "RESOLVED", resolvedAt: now },
  });

  const userIds = await resolveNotifyUserIds(input.onCallUserIds);
  await dispatchChannels({
    userIds,
    type: "alert_resolved",
    title: input.title,
    message: input.message,
    actionUrl: `/alert-rules?incident=${existing.id}`,
    notifyChannels: input.notifyChannels,
    webhookUrl: input.webhookUrl,
    contextLines: [
      `Server: ${existing.serverName}`,
      `Metric: ${existing.metric}`,
      `Incident: ${existing.id}`,
      `Previous level: ${existing.level}`,
    ],
    level: existing.level,
  });

  return { resolved: true, incidentId: existing.id };
}

export async function acknowledgeAlertIncident(input: {
  incidentId: string;
  userId: string;
}): Promise<{ id: string; status: string }> {
  const incident = await prisma.alertIncident.findUnique({ where: { id: input.incidentId } });
  if (!incident) throw new NotFoundError("Alert incident not found");
  if (incident.status === "RESOLVED") {
    throw new ValidationError("Resolved incidents cannot be acknowledged");
  }
  if (incident.status === "ACKNOWLEDGED") {
    return { id: incident.id, status: incident.status };
  }

  const updated = await prisma.alertIncident.update({
    where: { id: incident.id },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgedById: input.userId,
    },
  });
  return { id: updated.id, status: updated.status };
}

/**
 * Escalate OPEN incidents that exceeded rule.escalationMinutes without ack.
 * Level increases by 1 (capped at 3) and re-notifies on-call + admins.
 */
export async function escalateOverdueAlertIncidents(): Promise<{ escalated: number }> {
  const open = await prisma.alertIncident.findMany({
    where: { status: "OPEN" },
    include: {
      rule: {
        select: {
          id: true,
          name: true,
          escalationMinutes: true,
          onCallUserIds: true,
          notifyChannels: true,
          webhookUrl: true,
          enabled: true,
        },
      },
    },
    take: 200,
    orderBy: { createdAt: "asc" },
  });

  let escalated = 0;
  const now = Date.now();

  for (const incident of open) {
    if (!incident.rule?.enabled) continue;
    const minutes = Math.max(1, incident.rule.escalationMinutes ?? 30);
    const anchor = incident.lastNotifiedAt ?? incident.createdAt;
    if (now - anchor.getTime() < minutes * 60_000) continue;
    if (incident.level >= 3) continue;

    const nextLevel = Math.min(3, incident.level + 1);
    const updated = await prisma.alertIncident.update({
      where: { id: incident.id },
      data: {
        level: nextLevel,
        escalatedAt: new Date(),
        lastNotifiedAt: new Date(),
      },
    });

    const userIds = await resolveNotifyUserIds(incident.rule.onCallUserIds);
    // On L2+, also ensure notification:manage admins are included
    const adminIds = await resolveNotifyUserIds([]);
    const merged = Array.from(new Set([...userIds, ...adminIds]));

    await dispatchChannels({
      userIds: merged,
      type: "server_alert",
      title: incident.title,
      message: `${incident.message} — escalated to L${nextLevel} (no acknowledgement within ${minutes}m)`,
      actionUrl: `/alert-rules?incident=${incident.id}`,
      notifyChannels: incident.rule.notifyChannels,
      webhookUrl: incident.rule.webhookUrl,
      contextLines: [
        `Server: ${incident.serverName}`,
        `Metric: ${incident.metric}`,
        `Level: ${nextLevel}`,
        `Open since: ${incident.createdAt.toISOString()}`,
        `Incident: ${incident.id}`,
      ],
      level: nextLevel,
    });

    logger.info("alert incident escalated", {
      incidentId: updated.id,
      level: nextLevel,
      ruleId: incident.ruleId,
    });
    escalated += 1;
  }

  return { escalated };
}

export async function listAlertIncidents(options?: {
  status?: string;
  take?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const status = options?.status?.trim();
  // AlertIncident has serverId but no Prisma relation to Server — resolve
  // team-scoped server IDs first when a non-admin session is present.
  let serverScope: Record<string, unknown> = {};
  if (options?.session) {
    const teamFilter = teamWhere(options.session);
    if (Object.keys(teamFilter).length > 0) {
      const servers = await prisma.server.findMany({
        where: teamFilter,
        select: { id: true },
        take: 5000,
      });
      const ids = servers.map((s) => s.id);
      serverScope = {
        OR: [{ serverId: null }, { serverId: { in: ids } }],
      };
    }
  }
  return prisma.alertIncident.findMany({
    where: {
      ...(status ? { status } : {}),
      ...serverScope,
    },
    orderBy: [{ status: "asc" }, { level: "desc" }, { createdAt: "desc" }],
    take: options?.take ?? 100,
    include: {
      rule: { select: { id: true, name: true, escalationMinutes: true, onCallUserIds: true } },
      acknowledgedBy: { select: { id: true, username: true, displayName: true } },
    },
  });
}
