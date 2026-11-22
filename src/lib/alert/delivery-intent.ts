import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { liveCustomerRowsWhere } from "@/lib/auth/team-scope";
import { checkSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
import { isNowInAlertSilenceWindow } from "@/lib/health/service-types";
import { sampledEndpoint, sampledServerScope, type HealthEndpoint } from "@/lib/health/sample-binding";
import { configurationDigest, verifiedRuleChannels } from "./channel-grants";

export type AlertEvaluation = { version: string; sampledAt: Date; claim?: SamplingClaim; [sampledEndpoint]?: HealthEndpoint };
export type DeliveryTarget = {
  ruleId: string; serverId: string | null; metric: string; teamId?: string | null;
  webhookUrl?: string | null; onCallUserIds?: string[]; evaluation?: AlertEvaluation;
};

export function intentPrefix(ruleId: string) {
  return `alerts.intent.${createHash("sha256").update(ruleId).digest("hex")}.`;
}

export function intentKey(ruleId: string, incidentId: string) {
  return intentPrefix(ruleId) + incidentId;
}

export function encodeDeliveryIntent(version: string, openedAt: Date | null) {
  return JSON.stringify({ version, openedAt: openedAt?.toISOString() ?? null });
}

export async function readDeliveryIntent(ruleId: string, incidentId: string, db: Prisma.TransactionClient) {
  const row = await db.setting.findUnique({ where: { key: intentKey(ruleId, incidentId) }, select: { value: true } });
  if (!row?.value) return null;
  try {
    const stored = JSON.parse(row.value);
    if (typeof stored?.version !== "string") return null;
    const openedAt = typeof stored.openedAt === "string" ? new Date(stored.openedAt) : null;
    return { version: stored.version as string, openedAt: openedAt && Number.isFinite(openedAt.getTime()) ? openedAt : null };
  } catch { return null; }
}

/** Validate the collected configuration and host on the same snapshot as the claim. */
export async function currentDeliveryChannels(db: Prisma.TransactionClient, target: DeliveryTarget) {
  await checkSamplingClaim(db, target.evaluation?.claim);
  const rule = await db.alertRule.findFirst({
    where: { id: target.ruleId, enabled: true, teamId: target.teamId ?? null, metric: target.metric, ...liveCustomerRowsWhere() },
  });
  if (!rule || (target.evaluation && configurationDigest(rule) !== target.evaluation.version)
    || isNowInAlertSilenceWindow(rule.silenceWindows)) return null;
  if (target.serverId) {
    if (rule.serverIds.length && !rule.serverIds.includes(target.serverId)) return null;
    const endpoint = target.evaluation?.[sampledEndpoint];
    if (endpoint && (!endpoint.enabled || (rule.teamId && rule.teamId !== endpoint.teamId))) return null;
    const host = endpoint ? (await db.$queryRaw<{ id: string }[]>`SELECT s.id FROM servers s
      WHERE TRUE ${sampledServerScope([{ serverId: target.serverId, [sampledEndpoint]: endpoint }])} FOR SHARE OF s`)[0] : await db.server.findFirst({
      where: { id: target.serverId, enabled: true, ...(rule.teamId ? { teamId: rule.teamId } : {}), ...liveCustomerRowsWhere() },
      select: { id: true },
    });
    if (!host) return null;
  }
  const verified = await verifiedRuleChannels(rule, db);
  return verified.filter((channel) =>
    (channel !== "webhook" || rule.webhookUrl === (target.webhookUrl ?? null))
    && (channel !== "in_app" || JSON.stringify(rule.onCallUserIds) === JSON.stringify(target.onCallUserIds ?? [])));
}
