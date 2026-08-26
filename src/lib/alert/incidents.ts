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
import { prisma, isUniqueViolation } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { createNotification, type NotificationType } from "@/lib/notification/service";
import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";
import { t } from "@/lib/i18n/service-translations";
import type { AlertIncidentStatus } from "@prisma/client";

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
  /** Multi-tenant stamp for in-app notifications (from AlertRule.teamId). */
  teamId?: string | null;
  /**
   * Optional per-rule cooldown (minutes). When a prior incident for this
   * fingerprint was notified and is RESOLVED, suppress re-open+notify until
   * lastNotifiedAt + cooldown elapses. OPEN/ACKNOWLEDGED still never re-notify.
   */
  cooldownMinutes?: number;
};

export function buildAlertFingerprint(ruleId: string, serverId: string | null, metric: string): string {
  return `${ruleId}::${serverId ?? "fleet"}::${metric}`;
}

async function resolveNotifyUserIds(
  onCallUserIds: string[] | undefined,
  teamId?: string | null,
): Promise<string[]> {
  const preferred = (onCallUserIds ?? []).map((id) => id.trim()).filter(Boolean);
  const teamMemberFilter = teamId
    ? { teamMemberships: { some: { teamId } } }
    : {};
  if (preferred.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: preferred },
        status: { not: "DISABLED" },
        ...teamMemberFilter,
      },
      select: { id: true },
      take: 50,
    });
    if (users.length > 0) return users.map((u) => u.id);
  }
  // Fallback on-call pool: notification:manage users, scoped to the rule's team when set.
  const admins = await prisma.user.findMany({
    where: {
      status: { not: "DISABLED" },
      ...teamMemberFilter,
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

/** Per-channel delivery outcome, so callers never report a phantom "notified". */
export interface AlertDispatchResult {
  /** Channels that were configured AND delivered at least one message. */
  delivered: string[];
  /** Channels that were configured but failed, with the reason. */
  failed: { channel: string; error: string }[];
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
  teamId?: string | null;
}): Promise<AlertDispatchResult> {
  const delivered: string[] = [];
  const failed: { channel: string; error: string }[] = [];

  if (input.notifyChannels.includes("in_app")) {
    const results = await Promise.allSettled(
      input.userIds.map((userId) =>
        createNotification({
          userId,
          type: input.type,
          title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
          message: input.message,
          actionUrl: input.actionUrl,
          teamId: input.teamId ?? null,
        }),
      ),
    );
    // No recipients at all is a silent failure too: the rule looks armed but
    // nobody is on call.
    if (input.userIds.length === 0) {
      failed.push({ channel: "in_app", error: "no recipients resolved" });
    } else if (results.some((r) => r.status === "fulfilled")) {
      delivered.push("in_app");
    } else {
      const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      failed.push({
        channel: "in_app",
        error: first?.reason instanceof Error ? first.reason.message : String(first?.reason ?? "unknown"),
      });
    }
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
      delivered.push("webhook");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ channel: "webhook", error: message });
      logger.warn("alert webhook delivery failed", { error: message });
    }
  } else if (input.notifyChannels.includes("webhook")) {
    // Channel selected but no URL configured — the rule can never notify.
    failed.push({ channel: "webhook", error: "webhook URL not configured" });
  }

  if (input.notifyChannels.includes("email")) {
    try {
      await sendAlertEmail({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
      delivered.push("email");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ channel: "email", error: message });
      logger.warn("alert email delivery failed", { error: message });
    }
  }

  if (input.notifyChannels.includes("telegram")) {
    try {
      await sendAlertTelegram({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
      delivered.push("telegram");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ channel: "telegram", error: message });
      logger.warn("alert telegram delivery failed", { error: message });
    }
  }

  return { delivered, failed };
}

/**
 * Create or refresh an OPEN incident and send level-1 notifications.
 * Re-firing while OPEN/ACKNOWLEDGED only updates value; does not spam unless escalated.
 */
export async function openOrRefreshAlertIncident(input: AlertFireInput): Promise<{
  incidentId: string;
  created: boolean;
  /**
   * True only when an incident was opened or re-opened this pass (the dispatch
   * path was reached). Independent of whether any channel actually delivered —
   * callers use this to stamp `lastTriggeredAt` and run remediation playbooks so
   * a fire is recorded even when notification is best-effort and fails.
   */
  fired: boolean;
  notified: boolean;
  level: number;
  /** Channels that actually accepted the message. */
  deliveredChannels?: string[];
  /** Configured channels that failed, so the UI can show "notify failed". */
  failedChannels?: { channel: string; error: string }[];
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
      fired: false,
      notified: false,
      level: existing.level,
    };
  }

  // Per-fingerprint cooldown after RESOLVED: avoid immediate re-fire spam while
  // the metric stays over threshold. Multi-host isolation is preserved because
  // fingerprint includes serverId.
  const cooldownMs = Math.max(0, Number(input.cooldownMinutes ?? 0)) * 60_000;
  if (
    existing &&
    existing.status === "RESOLVED" &&
    cooldownMs > 0 &&
    existing.lastNotifiedAt &&
    now.getTime() - existing.lastNotifiedAt.getTime() < cooldownMs
  ) {
    return {
      incidentId: existing.id,
      created: false,
      fired: false,
      notified: false,
      level: existing.level,
    };
  }

  let incident;
  let created = false;
  if (existing) {
    incident = await prisma.alertIncident.update({
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
    });
  } else {
    try {
      incident = await prisma.alertIncident.create({
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
      created = true;
    } catch (error) {
      // Concurrent create on unique fingerprint — re-load and treat as refresh.
      if (!isUniqueViolation(error)) throw error;
      const raced = await prisma.alertIncident.findUnique({ where: { fingerprint } });
      if (!raced) throw error;
      if (raced.status === "OPEN" || raced.status === "ACKNOWLEDGED") {
        await prisma.alertIncident.update({
          where: { id: raced.id },
          data: {
            value: input.value,
            title: input.title,
            message: input.message,
            serverName: input.serverName,
          },
        });
        return {
          incidentId: raced.id,
          created: false,
          fired: false,
          notified: false,
          level: raced.level,
        };
      }
      incident = await prisma.alertIncident.update({
        where: { id: raced.id },
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
      });
    }
  }

  const userIds = await resolveNotifyUserIds(input.onCallUserIds, input.teamId);
  const dispatch = await dispatchChannels({
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
    teamId: input.teamId ?? null,
  });

  // `notified` must reflect reality. Reporting true while every channel failed
  // is the worst kind of silent failure: the operator believes they were paged.
  if (dispatch.failed.length > 0) {
    logger.warn("alert incident notification partially or fully failed", {
      incidentId: incident.id,
      delivered: dispatch.delivered,
      failed: dispatch.failed,
    });
  }

  return {
    incidentId: incident.id,
    created,
    fired: true,
    notified: dispatch.delivered.length > 0,
    level: 1,
    deliveredChannels: dispatch.delivered,
    failedChannels: dispatch.failed,
  };
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
  teamId?: string | null;
}): Promise<{
  resolved: boolean;
  incidentId?: string;
  notified?: boolean;
  deliveredChannels?: string[];
  failedChannels?: { channel: string; error: string }[];
}> {
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

  const userIds = await resolveNotifyUserIds(input.onCallUserIds, input.teamId);
  const dispatch = await dispatchChannels({
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
    teamId: input.teamId ?? null,
  });
  if (dispatch.failed.length > 0) {
    logger.warn("alert resolution notification partially or fully failed", {
      incidentId: existing.id,
      delivered: dispatch.delivered,
      failed: dispatch.failed,
    });
  }

  // The DB state change is what "resolved" means; delivery is reported separately
  // so a dead notify channel cannot make a resolved incident look unresolved.
  return {
    resolved: true,
    incidentId: existing.id,
    notified: dispatch.delivered.length > 0,
    deliveredChannels: dispatch.delivered,
    failedChannels: dispatch.failed,
  };
}

export async function acknowledgeAlertIncident(input: {
  incidentId: string;
  userId: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<{ id: string; status: string }> {
  // Scope: incident must belong to a server (or null) visible under teamWhere,
  // and its rule must also be visible (teamId null = legacy shared).
  const incident = await prisma.alertIncident.findUnique({
    where: { id: input.incidentId },
    include: { rule: { select: { id: true, teamId: true } } },
  });
  if (!incident) throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
  if (input.session) {
    const teamFilter = teamWhere(input.session);
    if (Object.keys(teamFilter).length > 0) {
      // Rule team: null = legacy shared — team operators cannot ack unless the
      // incident is bound to a server in their team (or they are global manager).
      const ruleTeam = incident.rule?.teamId ?? null;
      if (ruleTeam !== null) {
        const ruleOk = await prisma.alertRule.findFirst({
          where: { id: incident.ruleId, ...teamFilter },
          select: { id: true },
        });
        if (!ruleOk) throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
      } else if (!incident.serverId) {
        throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
      }
      // Server team (required when set, or when rule is legacy unscoped)
      if (incident.serverId) {
        const serverOk = await prisma.server.findFirst({
          where: { id: incident.serverId, ...teamFilter },
          select: { id: true },
        });
        if (!serverOk) throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
      }
    }
  }
  if (incident.status === "RESOLVED") {
    throw new ValidationError(t("backend.alert.resolvedIncidentsCannotBeAcknowledged"));
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
 * Uses conditional updateMany so overlapping workers cannot double-notify the same level.
 */
export async function escalateOverdueAlertIncidents(): Promise<{ escalated: number; notifyFailures: number }> {
  let escalated = 0;
  // Escalations that reached zero channels — the caller/cron can surface this.
  let notifyFailures = 0;
  const nowMs = Date.now();
  // Paginate until a short page so older rows beyond the first 200 are not starved.
  for (let page = 0; page < 20; page += 1) {
    const open = await prisma.alertIncident.findMany({
      where: { status: "OPEN" },
      include: {
        rule: {
          select: {
            id: true,
            name: true,
            teamId: true,
            escalationMinutes: true,
            onCallUserIds: true,
            notifyChannels: true,
            webhookUrl: true,
            enabled: true,
          },
        },
      },
      take: 200,
      skip: page * 200,
      orderBy: [{ lastNotifiedAt: "asc" }, { createdAt: "asc" }],
    });
    if (open.length === 0) break;

    for (const incident of open) {
      if (!incident.rule?.enabled) continue;
      const minutes = Math.max(1, incident.rule.escalationMinutes ?? 30);
      const anchor = incident.lastNotifiedAt ?? incident.createdAt;
      if (nowMs - anchor.getTime() < minutes * 60_000) continue;
      if (incident.level >= 3) continue;

      const nextLevel = Math.min(3, incident.level + 1);
      const threshold = new Date(nowMs - minutes * 60_000);
      const claimed = await prisma.alertIncident.updateMany({
        where: {
          id: incident.id,
          status: "OPEN",
          level: incident.level,
          OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lte: threshold } }],
        },
        data: {
          level: nextLevel,
          escalatedAt: new Date(),
          lastNotifiedAt: new Date(),
        },
      });
      if (claimed.count !== 1) continue;

      const userIds = await resolveNotifyUserIds(incident.rule.onCallUserIds, incident.rule.teamId ?? null);
      // On L2+, also include notification:manage users in the same team scope.
      const adminIds = await resolveNotifyUserIds([], incident.rule.teamId ?? null);
      const merged = Array.from(new Set([...userIds, ...adminIds]));

      const escalationDispatch = await dispatchChannels({
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
        teamId: incident.rule.teamId ?? null,
      });

      logger.info("alert incident escalated", {
        incidentId: incident.id,
        level: nextLevel,
        ruleId: incident.ruleId,
        delivered: escalationDispatch.delivered,
        failed: escalationDispatch.failed,
      });
      // An escalation nobody received is the failure mode escalation exists to
      // prevent — surface it loudly rather than counting it as a success.
      if (escalationDispatch.delivered.length === 0) {
        logger.error("alert escalation reached no channel", {
          incidentId: incident.id,
          level: nextLevel,
          failed: escalationDispatch.failed,
        });
        notifyFailures += 1;
      }
      escalated += 1;
    }

    if (open.length < 200) break;
  }

  return { escalated, notifyFailures };
}

export async function listAlertIncidents(options?: {
  status?: AlertIncidentStatus;
  take?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const status = options?.status;
  // AlertIncident has serverId but no Prisma relation to Server — resolve
  // team-scoped server IDs first when a non-admin session is present.
  // Also restrict null-server (fleet) incidents to rules visible under teamWhere
  // so other teams' fleet fingerprints do not leak via serverId:null OR branch.
  let scope: Record<string, unknown> = {};
  if (options?.session) {
    const teamFilter = teamWhere(options.session);
    if (Object.keys(teamFilter).length > 0) {
      const [servers, rules] = await Promise.all([
        prisma.server.findMany({
          where: teamFilter,
          select: { id: true },
          take: 5000,
        }),
        prisma.alertRule.findMany({
          where: teamFilter,
          select: { id: true },
          take: 2000,
        }),
      ]);
      const serverIds = servers.map((s) => s.id);
      const ruleIds = rules.map((r) => r.id);
      scope = {
        AND: [
          {
            OR: [
              { serverId: { in: serverIds } },
              // Fleet / null-server rows: only rules owned by (or legacy shared in) this team.
              { serverId: null, ruleId: { in: ruleIds } },
            ],
          },
        ],
      };
    }
  }
  return prisma.alertIncident.findMany({
    where: {
      ...(status ? { status } : {}),
      ...scope,
    },
    orderBy: [{ status: "asc" }, { level: "desc" }, { createdAt: "desc" }],
    take: options?.take ?? 100,
    include: {
      rule: { select: { id: true, name: true, escalationMinutes: true, onCallUserIds: true } },
      acknowledgedBy: { select: { id: true, username: true, displayName: true } },
    },
  });
}
