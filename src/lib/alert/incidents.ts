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
import { createHash } from "node:crypto";
import { Prisma, type AlertIncident } from "@prisma/client";
import { canAlertRuleTargetTeam } from "./rule-scope";
import { queueIncidentRemediation } from "./remediation";
import { checkSamplingClaim, withSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
import { currentDeliveryChannels, encodeDeliveryIntent, intentKey, readDeliveryIntent, type AlertEvaluation, type DeliveryTarget } from "./delivery-intent";
import { configurationDigest, verifiedRuleChannels } from "./channel-grants";
import { prisma, isUniqueViolation } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import type { SessionPayload } from "@/lib/auth/session";
import { liveCustomerRowsWhere, rawServerScope, seesAllCustomers } from "@/lib/auth/team-scope";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { createNotification, type NotificationType } from "@/lib/notification/service";
import { sendAlertEmail } from "@/lib/notification/email";
import { sendAlertTelegram } from "@/lib/notification/telegram";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";
import { t } from "@/lib/i18n/service-translations";
import { getRuntimeSettingNumber } from "@/lib/runtime-settings/service";
import { isNowInAlertSilenceWindow } from "@/lib/health/service-types";
import type { NotificationMessage } from "@/lib/notification/message";
import type { AlertIncidentStatus } from "@prisma/client";
import { customerPermissionHoldersWhere, PLATFORM_ADMIN_WHERE } from "@/lib/auth/permission-holders";

const logger = createLogger("alert:incidents");

export type AlertFireInput = {
  evaluation?: AlertEvaluation;
  playbookIds?: string[];
  silenceWindows?: string[];
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
  /**
   * The rule's escalation interval, for the copy of an escalation notice that
   * is re-sent to a channel which failed when the incident was escalated.
   */
  escalationMinutes?: number;
};

export function buildAlertFingerprint(ruleId: string, serverId: string | null, metric: string): string {
  return `${ruleId}::${serverId ?? "fleet"}::${metric}`;
}

async function resolveNotifyUserIds(
  onCallUserIds: string[] | undefined,
  teamId?: string | null,
  serverId?: string | null,
): Promise<string[]> {
  const preferred = (onCallUserIds ?? []).map((id) => id.trim()).filter(Boolean);
  const hostAccess = serverId ? { OR: [PLATFORM_ADMIN_WHERE, { serverAccess: { none: { serverId, canRead: false } } }] } : {};
  const teamMemberFilter = teamId
    ? { OR: [PLATFORM_ADMIN_WHERE, { teamMembership: { is: { teamId } } }] }
    : PLATFORM_ADMIN_WHERE;
  if (preferred.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: preferred },
        status: { not: "DISABLED" },
        AND: [teamMemberFilter, hostAccess],
      },
      select: { id: true },
      take: 50,
    });
    if (users.length > 0) return users.map((u) => u.id);
  }
  // Fallback on-call pool: the customer's notification managers, else the
  // platform administrators.
  if (teamId) {
    const staff = await prisma.user.findMany({
      where: { status: { not: "DISABLED" }, ...customerPermissionHoldersWhere("notification:manage", teamId), ...hostAccess },
      select: { id: true },
      take: 100,
    });
    if (staff.length > 0) return staff.map((u) => u.id);
  }
  const admins = await prisma.user.findMany({
    where: { status: { not: "DISABLED" }, ...PLATFORM_ADMIN_WHERE },
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

/** In-app copy for an incident event, rendered in each viewer's language. */
function incidentNotice(
  event: "fired" | "resolved" | "escalated",
  incident: { serverName: string; ruleName: string; metric: string; operator?: string; threshold?: number; value?: number },
  escalation?: { level: number; minutes: number },
): NotificationMessage {
  const offline = incident.metric === "server_offline";
  const base = { server: incident.serverName, rule: incident.ruleName };
  const metricKey = `alertRulesPage.createForm.metric.${incident.metric}`;
  if (event === "escalated") return { code: "alertEscalated", params: { ...base, metricKey, ...escalation } };
  if (event === "resolved") return offline ? { code: "alertBackOnline", params: base } : { code: "alertResolved", params: { ...base, metricKey } };
  if (offline) return { code: "alertOffline", params: base };
  const value = incident.value ?? 0;
  return {
    code: "alertFired",
    params: {
      ...base,
      metricKey,
      operatorKey: `alertRulesPage.createForm.operator.${incident.operator}`,
      threshold: incident.threshold ?? 0,
      value: Number.isInteger(value) ? value : value.toFixed(1),
    },
  };
}

async function dispatchChannels(input: {
  target: DeliveryTarget;
  userIds: string[];
  type: NotificationType;
  /** Localizable in-app copy; title/message remain the text for other channels. */
  notice?: NotificationMessage;
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

  async function claim(channel: string) {
    if (!input.notifyChannels.includes(channel)) return false;
    const channels = await prisma.$transaction((tx) => currentDeliveryChannels(tx, input.target), { isolationLevel: "RepeatableRead" });
    input.target.evaluation?.claim?.signal.throwIfAborted();
    return channels?.includes(channel) ?? false;
  }

  if (await claim("in_app")) {
    const results = await Promise.allSettled(
      input.userIds.map((userId) =>
        createNotification({
          userId,
          type: input.type,
          notice: input.notice,
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

  const webhook = await claim("webhook");
  if (webhook && input.webhookUrl) {
    try {
      const delivery = await fetchWebhookSafely(input.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.target.evaluation?.claim?.signal,
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
  } else if (webhook) {
    // Channel selected but no URL configured — the rule can never notify.
    failed.push({ channel: "webhook", error: "webhook URL not configured" });
  }

  if (await claim("email")) {
    try {
      // sendAlertEmail only throws on config problems; a successful SMTP session
      // that had every recipient rejected still resolves with accepted:[]. Treat
      // "zero accepted" as a failure so `notified` cannot report a phantom page.
      const result = await sendAlertEmail({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
      if (result.accepted.length > 0) {
        delivered.push("email");
        if (result.rejected.length > 0) {
          logger.warn("alert email partially delivered", {
            accepted: result.accepted.length,
            rejected: result.rejected.length,
          });
        }
      } else {
        failed.push({
          channel: "email",
          error: `all ${result.rejected.length} recipient(s) rejected`,
        });
        logger.warn("alert email delivery rejected for all recipients", {
          rejected: result.rejected.length,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ channel: "email", error: message });
      logger.warn("alert email delivery failed", { error: message });
    }
  }

  if (await claim("telegram")) {
    try {
      // Same contract as email: sendAlertTelegram resolves with accepted:[] when
      // every chat_id failed (per-chat errors are collected, not thrown). Only
      // count the channel delivered when at least one target actually accepted.
      const result = await sendAlertTelegram({
        title: input.level > 1 ? `[L${input.level}] ${input.title}` : input.title,
        message: input.message,
        contextLines: input.contextLines,
      });
      if (result.accepted.length > 0) {
        delivered.push("telegram");
        if (result.rejected.length > 0) {
          logger.warn("alert telegram partially delivered", {
            accepted: result.accepted.length,
            rejected: result.rejected.length,
          });
        }
      } else {
        failed.push({
          channel: "telegram",
          error: result.rejected[0]?.reason ?? `all ${result.rejected.length} target(s) failed`,
        });
        logger.warn("alert telegram delivery failed for all targets", {
          rejected: result.rejected.length,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ channel: "telegram", error: message });
      logger.warn("alert telegram delivery failed", { error: message });
    }
  }

  return { delivered, failed };
}

/** Fallback when the `alerts.notifyMaxAttempts` setting cannot be read. */
const MAX_NOTIFY_ATTEMPTS = 8;

async function notifyMaxAttempts(): Promise<number> {
  return getRuntimeSettingNumber("alerts.notifyMaxAttempts").catch(() => MAX_NOTIFY_ATTEMPTS);
}

/** 1, 2, 4 … minutes after attempt n, capped at an hour. */
function nextNotifyRetryAt(now: Date, attempts: number): Date {
  return new Date(now.getTime() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000);
}

function summarizeFailures(failed: { channel: string; error: string }[]): string {
  return failed.map((item) => `${item.channel}: ${item.error}`).join("; ").slice(0, 1000);
}

/** Delivery bookkeeping after an attempt; nothing pending → no retry scheduled. */
function deliveryState(now: Date, attempts: number, failed: { channel: string; error: string }[], maxAttempts = MAX_NOTIFY_ATTEMPTS) {
  const pending = Array.from(new Set(failed.map((item) => item.channel)));
  return {
    pendingNotifyChannels: pending,
    notifyAttempts: attempts,
    nextNotifyAt: pending.length > 0 && attempts < maxAttempts ? nextNotifyRetryAt(now, attempts) : null,
    lastNotifyError: pending.length > 0 ? summarizeFailures(failed) : null,
  };
}

/**
 * Delivery intent persisted together with the incident's (re)opening, before
 * anything is sent: every configured channel is pending and attempt 1 is
 * claimed until its retry time. If the process dies before or during the
 * send, or the bookkeeping after it fails, a later evaluation finds the
 * channels still pending once that time has passed and sends again. This is
 * at-least-once: a channel that did deliver before the crash may receive the
 * fired notice twice, which is preferable to never paging anyone. It also
 * replaces whatever delivery state a previous round of a reopened incident
 * left behind.
 */
function initialDeliveryState(now: Date, notifyChannels: string[]) {
  const pending = Array.from(new Set(notifyChannels));
  return {
    pendingNotifyChannels: pending,
    notifyAttempts: 1,
    nextNotifyAt: pending.length > 0 ? nextNotifyRetryAt(now, 1) : null,
    lastNotifyError: null,
  };
}

type FireDispatchInput = AlertFireInput & { incidentId: string };

function dispatchFiredNotice(input: FireDispatchInput, notifyChannels: string[]) {
  return resolveNotifyUserIds(input.onCallUserIds, input.teamId, input.serverId).then((userIds) => dispatchChannels({
    target: input, userIds,
    type: "server_alert",
    notice: incidentNotice("fired", input),
    title: input.title,
    message: input.message,
    actionUrl: `/alert-rules?incident=${input.incidentId}`,
    notifyChannels,
    webhookUrl: input.webhookUrl,
    contextLines: [
      `Server: ${input.serverName}`,
      `Metric: ${input.metric}`,
      `Current: ${input.value}`,
      `Threshold: ${input.operator} ${input.threshold}`,
      `Level: 1`,
      `Incident: ${input.incidentId}`,
    ],
    level: 1,
    teamId: input.teamId ?? null,
  }));
}

type EscalationDispatchInput = {
  target: DeliveryTarget;
  openedAt: Date | null;
  incident: { id: string; title: string; message: string; serverName: string; metric: string; createdAt: Date };
  rule: { name: string; teamId: string | null; onCallUserIds: string[]; webhookUrl: string | null };
  level: number;
  minutes: number;
};

/** Escalation copy to on-call plus the notification managers of the same scope. */
async function dispatchEscalationNotice({ incident, rule, level, minutes, target, openedAt }: EscalationDispatchInput, notifyChannels: string[]) {
  const userIds = await resolveNotifyUserIds(rule.onCallUserIds, rule.teamId, target.serverId);
  // On L2+, also include notification:manage users in the same team scope.
  const adminIds = await resolveNotifyUserIds([], rule.teamId, target.serverId);
  return dispatchChannels({
    target, userIds: Array.from(new Set([...userIds, ...adminIds])),
    type: "server_alert",
    notice: incidentNotice("escalated", { ...incident, ruleName: rule.name }, { level, minutes }),
    title: incident.title,
    message: `${incident.message} — escalated to L${level} (no acknowledgement within ${minutes}m)`,
    actionUrl: `/alert-rules?incident=${incident.id}`,
    notifyChannels,
    webhookUrl: rule.webhookUrl,
    contextLines: [
      `Server: ${incident.serverName}`,
      `Metric: ${incident.metric}`,
      `Level: ${level}`,
      ...(openedAt ? [`Open since: ${openedAt.toISOString()}`] : []),
      `Incident: ${incident.id}`,
    ],
    level,
    teamId: rule.teamId,
  });
}

/**
 * Re-send the pending notification to the channels that have not received it:
 * the fired notice at level 1, the latest escalation notice above it (an
 * escalation replaces the pending state of the round before it, see
 * {@link escalateOverdueAlertIncidents}). Only for OPEN incidents: an
 * acknowledged one has been seen by a person. The attempt is claimed with a
 * CAS on nextNotifyAt first, so two evaluators that see the same due row
 * cannot both send.
 */
async function retryPendingIncidentDelivery(
  existing: {
    id: string;
    status: string;
    level: number;
    title: string;
    message: string;
    serverName: string;
    metric: string;
    createdAt: Date;
    pendingNotifyChannels?: string[] | null;
    notifyAttempts?: number | null;
    nextNotifyAt?: Date | null;
    /** Snapshot taken when the incident escalated; used for retry copy. */
    escalationMinutes?: number | null;
    /** Stamped by each opening and escalation: which round this is. */
    lastNotifiedAt?: Date | null;
  },
  input: AlertFireInput,
  now: Date,
): Promise<AlertDispatchResult & { attempted: boolean }> {
  const round = { id: existing.id, status: "OPEN" as const, level: existing.level, lastNotifiedAt: existing.lastNotifiedAt ?? null };
  const attempts = existing.notifyAttempts ?? 0;
  if (existing.status !== "OPEN" || !existing.pendingNotifyChannels?.length) return { delivered: [], failed: [], attempted: false };
  const pending = existing.pendingNotifyChannels.filter((channel) => input.notifyChannels.includes(channel));
  const intent = input.evaluation && await readDeliveryIntent(input.ruleId, existing.id, prisma);
  if (!pending.length || (input.evaluation && input.evaluation.version !== intent?.version)) {
    await withSamplingClaim(input.evaluation?.claim, (tx) => tx.alertIncident.updateMany({
      where: { ...round, notifyAttempts: attempts, pendingNotifyChannels: { equals: existing.pendingNotifyChannels ?? [] } },
      data: { pendingNotifyChannels: [], nextNotifyAt: null, lastNotifyError: null },
    }));
    return { delivered: [], failed: [], attempted: false };
  }
  const maxAttempts = await notifyMaxAttempts();
  if (!existing.nextNotifyAt || existing.nextNotifyAt.getTime() > now.getTime() || attempts >= maxAttempts
    || isNowInAlertSilenceWindow(input.silenceWindows ?? [])) return { delivered: [], failed: [], attempted: false };
  const claimed = await withSamplingClaim(input.evaluation?.claim, (tx) => tx.alertIncident.updateMany({
    where: { ...round, notifyAttempts: attempts, nextNotifyAt: existing.nextNotifyAt },
    data: { notifyAttempts: attempts + 1, nextNotifyAt: nextNotifyRetryAt(now, attempts + 1) },
  }));
  if (claimed.count === 0) return { delivered: [], failed: [], attempted: false };
  const dispatch = existing.level > 1
    ? await dispatchEscalationNotice({
        target: input, incident: existing, openedAt: intent?.openedAt ?? null,
        rule: {
          name: input.ruleName,
          teamId: input.teamId ?? null,
          onCallUserIds: input.onCallUserIds ?? [],
          webhookUrl: input.webhookUrl ?? null,
        },
        level: existing.level,
        // Quote the snapshot taken at escalation time; only fall back to the
        // rule's current value for incidents that predate the column.
        minutes: Math.max(1, existing.escalationMinutes ?? input.escalationMinutes ?? (await getRuntimeSettingNumber("alerts.defaultEscalationMinutes").catch(() => 30))),
      }, pending)
    : await dispatchFiredNotice({ ...input, incidentId: existing.id }, pending);
  // Only for the round it sent: an escalation in the meantime replaced the
  // pending state, and this late level-N result must not clear it — nor the
  // state of a later opening of the same incident (same id, OPEN, level 1).
  await withSamplingClaim(input.evaluation?.claim, (tx) => tx.alertIncident.updateMany({
    where: { ...round, notifyAttempts: attempts + 1 },
    data: deliveryState(now, attempts + 1, dispatch.failed, maxAttempts),
  }));
  if (dispatch.failed.length > 0) {
    logger.warn("alert incident notification retry failed", { incidentId: existing.id, attempt: attempts + 1, failed: dispatch.failed });
  }
  return { ...dispatch, attempted: true };
}

/** Keep the source sample watermark and the routing digest in the same commit as the incident.
 * An escalation replaces the digest, while an ordinary refresh only advances the watermark.
 */
class OlderSample extends Error {}
async function recordSample(tx: Prisma.TransactionClient, target: DeliveryTarget, id: string, openedAt?: Date) {
  if (!target.evaluation) return;
  const { version, sampledAt } = target.evaluation;
  const key = intentKey(target.ruleId, id);
  const count = await tx.$executeRaw`INSERT INTO settings (key, value, "updatedAt") VALUES (${key}, ${openedAt ? encodeDeliveryIntent(version, openedAt) : ""}, ${sampledAt})
    ON CONFLICT (key) DO UPDATE SET value = ${openedAt ? Prisma.sql`EXCLUDED.value` : Prisma.sql`settings.value`},
      "updatedAt" = EXCLUDED."updatedAt" WHERE settings."updatedAt" <= EXCLUDED."updatedAt"`;
  if (count !== 1) throw new OlderSample();
}

function incidentWrite<T>(target: DeliveryTarget, write: (tx: Prisma.TransactionClient) => Promise<T | null>) {
  return prisma.$transaction(async (tx) => {
    if (target.evaluation && !await currentDeliveryChannels(tx, target)) return null;
    const result = await write(tx);
    await checkSamplingClaim(tx, target.evaluation?.claim);
    return result;
  }).catch((error: unknown) => {
    if (error instanceof OlderSample) return null;
    throw error;
  });
}

async function saveOpening(input: AlertFireInput, now: Date, write: (tx: Prisma.TransactionClient) => Promise<AlertIncident | null>) {
  return incidentWrite(input, async (tx) => {
    if (isNowInAlertSilenceWindow(input.silenceWindows ?? [])) return null;
    const row = await write(tx);
    if (row) {
      await recordSample(tx, input, row.id, now);
      await queueIncidentRemediation(tx, input, row.id, now);
    }
    return row;
  });
}

function refreshIncident(existing: AlertIncident, input: AlertFireInput) {
  return incidentWrite(input, async (tx) => {
    const res = await tx.alertIncident.updateMany({
      where: { id: existing.id, createdAt: existing.createdAt, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { value: input.value, operator: input.operator, threshold: input.threshold, title: input.title, message: input.message, serverName: input.serverName },
    });
    if (!res.count) return null;
    await recordSample(tx, input, existing.id);
    return true;
  });
}

/** Lost the reopen race: the winner notifies; this caller reports no fire. */
async function alreadyReopened(id: string) {
  const current = await prisma.alertIncident.findUnique({ where: { id }, select: { level: true } });
  return { incidentId: id, created: false, fired: false, notified: false, level: current?.level ?? 1 };
}

/** Open an incident and queue its remediation, or refresh its value and retry pending channels. */
export async function openOrRefreshAlertIncident(input: AlertFireInput): Promise<{
  incidentId: string | null;
  created: boolean;
  /**
   * True only when an incident was opened or re-opened this pass (the dispatch
   * path was reached). Independent of whether any channel actually delivered —
   * callers use this to stamp `lastTriggeredAt` even when notification fails.
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
  // A new opening must have its own stamp even with a fixed clock, or a
  // resolve/reopen within one millisecond could reuse the old delivery key.
  const now = existing?.status === "RESOLVED"
    ? new Date(Math.max(Date.now(), (existing.createdAt?.getTime() ?? 0) + 1, (existing.lastNotifiedAt?.getTime() ?? 0) + 1))
    : new Date();

  if (existing && (existing.status === "OPEN" || existing.status === "ACKNOWLEDGED")) {
    if (!await refreshIncident(existing, input)) return alreadyReopened(existing.id);
    const retry = await retryPendingIncidentDelivery(existing, input, now);
    return {
      incidentId: existing.id,
      created: false,
      fired: false,
      notified: retry.delivered.length > 0,
      level: existing.level,
      ...(retry.attempted ? { deliveredChannels: retry.delivered, failedChannels: retry.failed } : {}),
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

  const reopenData = {
    status: "OPEN" as const,
    createdAt: now,
    level: 1,
    value: input.value,
    operator: input.operator,
    threshold: input.threshold,
    title: input.title,
    message: input.message,
    serverName: input.serverName,
    acknowledgedAt: null,
    acknowledgedById: null,
    escalatedAt: null,
    escalationMinutes: null,
    resolvedAt: null,
    lastNotifiedAt: now,
    ...initialDeliveryState(now, input.notifyChannels),
  };
  const reopen = (previous: AlertIncident) => saveOpening(input, now, async (tx) => {
    const [row] = await tx.alertIncident.updateManyAndReturn({
      where: { id: previous.id, status: "RESOLVED", lastNotifiedAt: previous.lastNotifiedAt, resolvedAt: previous.resolvedAt },
      data: reopenData,
    });
    return row ?? null;
  });
  let incident;
  let created = false;
  if (existing) {
    const reopened = await reopen(existing);
    if (!reopened) return alreadyReopened(existing.id);
    incident = reopened;
  } else {
    try {
      incident = await saveOpening(input, now, (tx) => tx.alertIncident.create({
        data: {
          fingerprint, createdAt: now,
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
          ...initialDeliveryState(now, input.notifyChannels),
        },
      }));
      created = true;
    } catch (error) {
      // Concurrent create on unique fingerprint — re-load and treat as refresh.
      if (!isUniqueViolation(error)) throw error;
      const raced = await prisma.alertIncident.findUnique({ where: { fingerprint } });
      if (!raced) throw error;
      if (raced.status === "OPEN" || raced.status === "ACKNOWLEDGED") {
        await refreshIncident(raced, input);
        return {
          incidentId: raced.id,
          created: false,
          fired: false,
          notified: false,
          level: raced.level,
        };
      }
      // Reread cooldown and choose a stamp newer than the opening that raced us.
      return openOrRefreshAlertIncident(input);
    }
  }

  // Silence started while the evaluation waited. A still-matching host can
  // claim its opening and remediation together when the window ends.
  if (!incident) return { incidentId: null, created: false, fired: false, notified: false, level: 1 };
  const incidentId = incident.id;
  const dispatch = await dispatchFiredNotice({ ...input, incidentId }, input.notifyChannels);
  // Delivery state is kept apart from the incident state so a failed channel
  // is retried by later evaluations instead of being forgotten. Best effort:
  // losing this bookkeeping must not turn a recorded fire into a failure — the
  // intent persisted with the incident then still has every channel pending.
  try {
    // This opening only (stamped with `now` above). Resolved and opened again
    // while this send ran, the incident has the same id, OPEN and level 1:
    // the late result cleared the new round's failed channels and retry.
    const maxAttempts = await notifyMaxAttempts();
    await withSamplingClaim(input.evaluation?.claim, (tx) => tx.alertIncident.updateMany({
      where: { id: incidentId, status: "OPEN", level: 1, lastNotifiedAt: now, notifyAttempts: 1 },
      data: deliveryState(now, 1, dispatch.failed, maxAttempts),
    }));
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    logger.error("failed to record alert notification delivery state", {
      incidentId: incident.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

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
  evaluation?: AlertEvaluation;
  ruleId: string;
  /** Rule name for the localized in-app notification. */
  ruleName?: string;
  serverId: string | null;
  metric: string;
  title: string;
  message: string;
  notifyChannels: string[];
  silenceWindows?: string[];
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
  if (isNowInAlertSilenceWindow(input.silenceWindows ?? [], now)) return { resolved: false };
  // Only the caller that actually moves it to RESOLVED notifies: two
  // evaluations seeing the metric recover used to send "resolved" twice.
  const claimed = await incidentWrite(input, async (tx) => {
    const result = await tx.alertIncident.updateMany({
      where: { id: existing.id, createdAt: existing.createdAt, status: { in: ["OPEN", "ACKNOWLEDGED"] }, lastNotifiedAt: existing.lastNotifiedAt },
      data: { status: "RESOLVED", resolvedAt: now, pendingNotifyChannels: [], nextNotifyAt: null },
    });
    if (result.count) await recordSample(tx, input, existing.id);
    return result.count;
  });
  if (!claimed) return { resolved: false };

  const userIds = await resolveNotifyUserIds(input.onCallUserIds, input.teamId, input.serverId);
  const dispatch = await dispatchChannels({
    target: input, userIds,
    type: "alert_resolved",
    notice: input.ruleName ? incidentNotice("resolved", { ...existing, ruleName: input.ruleName }) : undefined,
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
  openedAt?: string | Date;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const session = input.session;
  const scope = !session || seesAllCustomers(session) ? Prisma.sql`TRUE` : Prisma.sql`
    ((r."teamId" = ${session.currentTeamId} AND i."serverId" IS NULL)
      OR ((r."teamId" IS NULL OR r."teamId" = ${session.currentTeamId}) AND EXISTS
        (SELECT 1 FROM servers s WHERE s.id = i."serverId" AND ${rawServerScope(session, "canRead")})))`;
  type Row = { id: string; status: AlertIncidentStatus; createdAt: Date; teamId: string | null };
  const read = () => prisma.$queryRaw<Row[]>`SELECT i.id, i.status, i."createdAt", r."teamId" FROM alert_incidents i
    JOIN alert_rules r ON r.id = i."ruleId" WHERE i.id = ${input.incidentId} AND ${scope}`;
  const [incident] = await read();
  if (!incident) throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
  const openedAt = input.openedAt === undefined ? incident.createdAt : new Date(input.openedAt);
  function checkRound(row: Row) {
    if (row.createdAt.getTime() !== openedAt.getTime()) throw new ConflictError(t("backend.alert.ruleChanged"));
    if (row.status === "RESOLVED") throw new ValidationError(t("backend.alert.resolvedIncidentsCannotBeAcknowledged"));
  }
  checkRound(incident);
  if (incident.status === "ACKNOWLEDGED") return incident;
  const [updated] = await prisma.$queryRaw<Row[]>`UPDATE alert_incidents i SET status = 'ACKNOWLEDGED',
    "acknowledgedAt" = now(), "updatedAt" = now(), "acknowledgedById" = ${input.userId}, "nextNotifyAt" = NULL
    FROM alert_rules r WHERE r.id = i."ruleId" AND i.id = ${incident.id} AND i.status = 'OPEN'
      AND i."createdAt" = ${openedAt} AND ${scope}
    RETURNING i.id, i.status, i."createdAt", r."teamId"`;
  if (updated) return updated;
  const [current] = await read();
  if (!current) throw new NotFoundError(t("backend.alert.alertIncidentNotFound"));
  checkRound(current);
  if (current.status !== "ACKNOWLEDGED") throw new ConflictError(t("backend.alert.ruleChanged"));
  return current;
}

/** Persist bounded sweep progress per scope. A slower evaluator cannot rewind a newer cursor. */
async function scanCursor(kind: string, scope: Record<string, unknown> | undefined, claim?: SamplingClaim) {
  const key = `alerts.scan.${kind}.${createHash("sha256").update(JSON.stringify(scope ?? {})).digest("hex")}`;
  const prior = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  return {
    afterId: prior?.value,
    async finish(afterId?: string) {
      if (!prior && !afterId) return;
      await withSamplingClaim(claim, async (tx) => {
        if (prior) {
          const where = { key, value: prior.value };
          if (afterId) await tx.setting.updateMany({ where, data: { value: afterId } });
          else await tx.setting.deleteMany({ where });
        } else if (afterId) {
          await tx.setting.createMany({ data: { key, value: afterId }, skipDuplicates: true });
        }
      });
    },
  };
}

/**
 * Resolve incidents that no evaluation can reach any more. `evaluateAlerts`
 * looks at enabled rules and, for each, at the existing, enabled servers the
 * rule covers, under the rule's current metric. An incident outside that can
 * never recover on its own:
 *
 * - its server was deleted or disabled: it kept escalating to L3 and paging
 *   on-call, and once the server row is gone team operators cannot even
 *   acknowledge it (the ownership check in {@link acknowledgeAlertIncident});
 * - its rule was disabled: it stayed open, with no escalation and no way to
 *   close it;
 * - its rule watches another metric now (the fingerprint holds the metric), or
 *   the server was taken off the rule's list or moved to another customer: it
 *   stayed open and escalated to L3.
 *
 * Marking them RESOLVED without a notice lets the queue heal itself; when the
 * rule or server comes back and still breaches, evaluateAlerts opens the
 * incident again.
 *
 * A server that merely went *offline* is untouched — its row still exists and is
 * enabled (`enabled` is the monitoring intent, not liveness), which is exactly
 * what `server_offline` incidents track. Fleet incidents (serverId = null) are
 * also never touched: they are not bound to a single host. `ruleTeamWhere`
 * scopes cleanup to one tenant when invoked from a manual, team-scoped trigger.
 */
export async function resolveOrphanedAlertIncidents(options?: {
  claim?: SamplingClaim;
  ruleTeamWhere?: Record<string, unknown>;
}): Promise<{ resolved: number }> {
  const ruleFilter =
    options?.ruleTeamWhere && Object.keys(options.ruleTeamWhere).length > 0
      ? { rule: options.ruleTeamWhere }
      : {};
  let resolved = 0;
  const cursor = await scanCursor("orphans", options?.ruleTeamWhere, options?.claim);
  let afterId = cursor.afterId;
  // Keyset by id. Resuming from a cursor row skipped the row after it whenever
  // that cursor row had just been resolved: it no longer matched the status
  // filter, so the "skip the cursor row" step dropped a real one instead.
  for (let page = 0; page < 50; page += 1) {
    options?.claim?.signal.throwIfAborted();
    const active = await prisma.alertIncident.findMany({
      where: {
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        serverId: { not: null },
        ...ruleFilter,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: {
        id: true, createdAt: true, serverId: true, metric: true,
        rule: { select: { enabled: true, metric: true, serverIds: true, teamId: true, team: { select: { deletedAt: true } } } },
      },
      take: 500,
      orderBy: { id: "asc" },
    });
    if (active.length === 0) { afterId = undefined; break; }
    afterId = active[active.length - 1]!.id;

    const serverIds = Array.from(new Set(active.map((i) => i.serverId).filter((v): v is string => Boolean(v))));
    const live = serverIds.length
      ? await prisma.server.findMany({
          where: { id: { in: serverIds }, enabled: true, ...liveCustomerRowsWhere() },
          select: { id: true, teamId: true },
        })
      : [];
    const liveServers = new Map(live.map((s) => [s.id, s]));
    const orphans = active
      .filter((incident) => {
        if (!incident.serverId) return false;
        const server = liveServers.get(incident.serverId);
        if (!server) return true;
        const rule = incident.rule;
        if (!rule) return false;
        if (!rule.enabled || rule.team?.deletedAt || rule.metric !== incident.metric) return true;
        if (!canAlertRuleTargetTeam(rule.teamId, server.teamId)) return true;
        return rule.serverIds.length > 0 && !rule.serverIds.includes(incident.serverId);
      });
    if (orphans.length) {
      const reviewed = orphans.map((row) => Prisma.sql`(${row.id}, ${row.createdAt}::timestamp, ${row.rule.teamId}::text)`);
      resolved += await withSamplingClaim(options?.claim, (tx) => tx.$executeRaw`
        UPDATE alert_incidents i SET status = 'RESOLVED', "resolvedAt" = now(), "updatedAt" = now(),
          "pendingNotifyChannels" = ARRAY[]::text[], "nextNotifyAt" = NULL
        FROM alert_rules r, (VALUES ${Prisma.join(reviewed)}) v(id, opened, owner)
        WHERE i.id = v.id AND i."createdAt" = v.opened AND i.status IN ('OPEN', 'ACKNOWLEDGED')
          AND r.id = i."ruleId" AND r."teamId" IS NOT DISTINCT FROM v.owner AND i."serverId" IS NOT NULL
          AND NOT (r.enabled AND r.metric = i.metric AND (COALESCE(cardinality(r."serverIds"), 0) = 0 OR i."serverId" = ANY(r."serverIds"))
            AND EXISTS (SELECT 1 FROM servers s LEFT JOIN teams t ON t.id = s."teamId"
              WHERE s.id = i."serverId" AND s.enabled AND t."deletedAt" IS NULL AND (r."teamId" IS NULL OR r."teamId" = s."teamId")))`);
    }
    if (active.length < 500) { afterId = undefined; break; }
  }
  await cursor.finish(afterId);
  if (resolved > 0) logger.info("auto-resolved orphaned alert incidents", { resolved });
  return { resolved };
}

/**
 * Escalate OPEN incidents that exceeded rule.escalationMinutes without ack.
 * Level increases by 1 (capped at 3) and re-notifies on-call + admins.
 * Uses conditional updateMany so overlapping workers cannot double-notify the same level.
 *
 * First self-heals orphaned incidents (a deleted or disabled server, a disabled
 * or changed rule) so they stop escalating forever — see
 * {@link resolveOrphanedAlertIncidents}.
 * `ruleTeamWhere` (from a manual, team-scoped trigger) restricts both the orphan
 * sweep and escalation to incidents whose rule is visible to that tenant, so one
 * team's "evaluate now" never drives another team's incident lifecycle.
 */
export async function escalateOverdueAlertIncidents(options?: {
  claim?: SamplingClaim;
  ruleTeamWhere?: Record<string, unknown>;
}): Promise<{ escalated: number; notifyFailures: number; orphansResolved: number }> {
  const { resolved: orphansResolved } = await resolveOrphanedAlertIncidents(options);
  let escalated = 0;
  // Escalations that reached zero channels — the caller/cron can surface this.
  let notifyFailures = 0;
  const defaultEscalationMinutes = await getRuntimeSettingNumber("alerts.defaultEscalationMinutes").catch(() => 30);
  const maxAttempts = await notifyMaxAttempts();
  const cursor = await scanCursor("escalations", options?.ruleTeamWhere, options?.claim);
  let afterId = cursor.afterId;
  for (let page = 0; page < 20; page += 1) {
    options?.claim?.signal.throwIfAborted();
    const open = await prisma.alertIncident.findMany({
      where: {
        status: "OPEN",
        rule: { AND: [options?.ruleTeamWhere ?? {}, liveCustomerRowsWhere(), { enabled: true }] },
        level: { lt: 3 },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      include: { rule: true },
      take: 200,
      orderBy: { id: "asc" },
    });
    if (open.length === 0) { afterId = undefined; break; }

    for (const incident of open) {
      options?.claim?.signal.throwIfAborted();
      if (!incident.rule?.enabled) continue;
      // A silence window promises no in-app notice or webhook: hold the
      // escalation; its anchor is unchanged, so it goes out once the window ends.
      if (isNowInAlertSilenceWindow(incident.rule.silenceWindows ?? [])) continue;
      const minutes = Math.max(1, incident.rule.escalationMinutes ?? defaultEscalationMinutes);
      const anchor = incident.lastNotifiedAt ?? incident.createdAt;
      if (Date.now() - anchor.getTime() < minutes * 60_000) continue;
      if (incident.level >= 3) continue;

      const nextLevel = Math.min(3, incident.level + 1);
      if (incident.serverId) {
        const rule = incident.rule;
        if (rule.metric !== incident.metric || (rule.serverIds.length && !rule.serverIds.includes(incident.serverId))) continue;
        const host = await prisma.server.findFirst({
          where: { id: incident.serverId, enabled: true, ...(rule.teamId ? { teamId: rule.teamId } : {}), ...liveCustomerRowsWhere() },
          select: { id: true },
        });
        if (!host) continue;
      }
      const channels = await verifiedRuleChannels(incident.rule);
      const escalatedAt = new Date();
      if (isNowInAlertSilenceWindow(incident.rule.silenceWindows ?? [], escalatedAt)) continue;
      // A legacy L1 row still has this opening's timestamp. On older L2/L3
      // rows both that timestamp and the original delivery intent may be gone.
      const openedAt = incident.level === 1 ? incident.lastNotifiedAt ?? incident.createdAt
        : (await readDeliveryIntent(incident.ruleId, incident.id, prisma))?.openedAt ?? null;
      // The claim also persists the escalation's delivery intent (every
      // channel pending, attempt 1 claimed), replacing whatever the previous
      // level left pending: the escalation is the notice that matters now, and
      // a channel that missed it is retried by later evaluations like a missed
      // fired notice. At-least-once, as for the fired notice.
      const target = {
        ruleId: incident.ruleId, serverId: incident.serverId, metric: incident.metric,
        teamId: incident.rule.teamId, webhookUrl: incident.rule.webhookUrl, onCallUserIds: incident.rule.onCallUserIds,
        evaluation: { version: configurationDigest(incident.rule), sampledAt: escalatedAt, claim: options?.claim },
      };
      const claimed = await prisma.$transaction(async (tx) => {
        await checkSamplingClaim(tx, options?.claim);
        const res = await tx.alertIncident.updateMany({
          where: {
            id: incident.id, createdAt: incident.createdAt,
            status: "OPEN",
            level: incident.level,
            lastNotifiedAt: incident.lastNotifiedAt,
            rule: { updatedAt: incident.rule.updatedAt, enabled: true, ...liveCustomerRowsWhere() },
          },
          data: {
            level: nextLevel,
            escalatedAt,
            lastNotifiedAt: escalatedAt,
            escalationMinutes: minutes,
            ...initialDeliveryState(escalatedAt, channels),
          },
        });
        if (res.count) {
          const key = intentKey(incident.ruleId, incident.id);
          await tx.$executeRaw`INSERT INTO settings (key, value, "updatedAt") VALUES (${key}, ${encodeDeliveryIntent(target.evaluation.version, openedAt)}, ${incident.createdAt})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        }
        return res;
      });
      if (claimed.count !== 1) continue;

      const escalationDispatch = await dispatchEscalationNotice({
        incident, target, openedAt,
        rule: { ...incident.rule, teamId: incident.rule.teamId ?? null },
        level: nextLevel,
        minutes,
      }, channels);
      // Best effort, like the fired notice: losing this write leaves every
      // channel pending, so the escalation is re-sent rather than forgotten.
      try {
        await withSamplingClaim(options?.claim, (tx) => tx.alertIncident.updateMany({
          where: { id: incident.id, status: "OPEN", level: nextLevel, lastNotifiedAt: escalatedAt, notifyAttempts: 1 },
          data: deliveryState(escalatedAt, 1, escalationDispatch.failed, maxAttempts),
        }));
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        logger.error("failed to record alert escalation delivery state", {
          incidentId: incident.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

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

    afterId = open.length === 200 ? open[open.length - 1]!.id : undefined;
    if (!afterId) break;
  }
  await cursor.finish(afterId);

  return { escalated, notifyFailures, orphansResolved };
}

export async function listAlertIncidents(options?: {
  status?: AlertIncidentStatus;
  take?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const status = options?.status;
  const readIncidents = (db: Prisma.TransactionClient, scope: Prisma.AlertIncidentWhereInput = {}) => db.alertIncident.findMany({
    where: { ...(status ? { status } : {}), ...scope },
    orderBy: [{ status: "asc" }, { level: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: options?.take ?? 100,
    include: {
      rule: { select: { id: true, name: true, escalationMinutes: true, onCallUserIds: true, teamId: true } },
      acknowledgedBy: { select: { id: true, username: true, displayName: true } },
    },
  });
  const session = options?.session;
  if (!session || seesAllCustomers(session)) return readIncidents(prisma);
  const teamId = session.currentTeamId;
  if (!teamId) return [];

  // AlertIncident has no server relation. Read both sides on one snapshot so
  // a transfer during listing cannot mix the old fleet with newer incidents.
  return prisma.$transaction(async (tx) => {
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT i.id FROM alert_incidents i JOIN alert_rules r ON r.id = i."ruleId"
      WHERE (${status ?? null}::"AlertIncidentStatus" IS NULL OR i.status = ${status ?? null}::"AlertIncidentStatus")
        AND ((r."teamId" = ${teamId} AND i."serverId" IS NULL)
          OR ((r."teamId" IS NULL OR r."teamId" = ${teamId}) AND EXISTS (
            SELECT 1 FROM servers s WHERE s.id = i."serverId" AND ${rawServerScope(session, "canRead")}
          )))
      ORDER BY i.status ASC, i.level DESC, i."createdAt" DESC, i.id ASC LIMIT ${options?.take ?? 100}`;
    return readIncidents(tx, { id: { in: ids.map((row) => row.id) } });
  }, { isolationLevel: "RepeatableRead" });
}
