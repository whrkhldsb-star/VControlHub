/**
 * Automatic Playbook trigger dispatch.
 *
 * Cron occurrences are materialized through Playbook.nextRunAt and queued by
 * the dedicated tick worker. Metric triggers are evaluated from freshly
 * collected health readings and fire only on a per-server threshold edge.
 * Both paths create PlaybookRun + Job in the same transaction.
 */
import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { auditSystemAction } from "@/lib/audit/service";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";
import type { ServerHealth } from "@/lib/health/service-types";

import { queuePlaybookRunWithClient } from "./run-queue";
import type { MetricTriggerConfig, PlaybookStep } from "./types";
import {
  computeNextPlaybookCronRun,
  isCronTriggerConfig,
  isMetricTriggerConfig,
  metricMatchesThreshold,
  metricValueForTrigger,
  parseMetricMatchState,
} from "./trigger-utils";

const MAX_TRIGGER_PLAYBOOKS_PER_TICK = 500;

type TriggerReading = {
  serverId: string;
  teamId: string | null;
  cpu?: number;
  mem?: number;
  diskMax?: number;
  sampleAt: string;
};

type TriggerQueuePlaybook = {
  id: string;
  name: string;
  steps: unknown;
  chainRetry: number;
  createdById: string | null;
  teamId: string | null;
};

type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AuditJsonValue }
  | AuditJsonValue[];
type AuditDetail = Record<string, AuditJsonValue>;

function queueablePlaybook(row: TriggerQueuePlaybook) {
  return {
    id: row.id,
    name: row.name,
    steps: row.steps as PlaybookStep[],
    chainRetry: row.chainRetry,
    createdById: row.createdById,
    teamId: row.teamId,
  };
}

async function recordTriggerAudit(
  action: "playbook.trigger.cron" | "playbook.trigger.metric",
  context: AuditDetail,
): Promise<void> {
  // The run/job transaction has already committed at this point. Audit
  // availability must not cause a retry that replays an automatic action.
  try {
    await auditSystemAction(action, context, "INFO");
  } catch {
    // The durable PlaybookRun, Job and trigger context remain observable even
    // if the optional audit write is temporarily unavailable.
  }
}

/** Initialize schedules for Cron playbooks that predate nextRunAt. */
export async function initializeCronPlaybookSchedule(
  playbookId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const release = await tryAcquireAdvisoryLock("playbook-lifecycle", playbookId);
  if (!release) return false;
  try {
    return await prisma.$transaction(async (tx) => {
      const playbook = await tx.playbook.findUnique({ where: { id: playbookId } });
      if (
        !playbook
        || !playbook.enabled
        || playbook.triggerType !== "cron"
        || playbook.nextRunAt !== null
        || !isCronTriggerConfig(playbook.triggerConfig)
      ) {
        return false;
      }
      const nextRunAt = computeNextPlaybookCronRun(playbook.triggerConfig.expression, now);
      const updated = await tx.playbook.updateMany({
        where: {
          id: playbookId,
          enabled: true,
          triggerType: "cron",
          nextRunAt: null,
        },
        data: { nextRunAt },
      });
      return updated.count === 1;
    });
  } finally {
    await release();
  }
}

/**
 * Queue a single due Cron occurrence. The next timestamp, PlaybookRun and
 * durable executor Job commit atomically. On restart we run at most one
 * catch-up occurrence and then move directly to the next future occurrence,
 * avoiding a dangerous burst of historical commands.
 */
export async function dispatchDueCronPlaybook(input: {
  playbookId: string;
  dueAt: Date;
  now?: Date;
}): Promise<{ dispatched: boolean; advanced: boolean }> {
  const now = input.now ?? new Date();
  const release = await tryAcquireAdvisoryLock("playbook-lifecycle", input.playbookId);
  if (!release) return { dispatched: false, advanced: false };
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const playbook = await tx.playbook.findUnique({ where: { id: input.playbookId } });
      if (
        !playbook
        || !playbook.enabled
        || playbook.triggerType !== "cron"
        || !playbook.nextRunAt
        || playbook.nextRunAt.getTime() !== input.dueAt.getTime()
        || !isCronTriggerConfig(playbook.triggerConfig)
      ) {
        return { dispatched: false, advanced: false, audit: null as AuditDetail | null };
      }

      const expression = playbook.triggerConfig.expression;
      const nextRunAt = computeNextPlaybookCronRun(expression, now);
      const advanced = await tx.playbook.updateMany({
        where: {
          id: playbook.id,
          enabled: true,
          triggerType: "cron",
          nextRunAt: input.dueAt,
        },
        data: { nextRunAt, lastTriggeredAt: now },
      });
      if (advanced.count !== 1) {
        return { dispatched: false, advanced: false, audit: null as AuditDetail | null };
      }

      const scheduledFor = input.dueAt.toISOString();
      const queued = await queuePlaybookRunWithClient({
        client: tx,
        playbook: queueablePlaybook(playbook),
        dryRun: false,
        createdById: playbook.createdById,
        triggerKey: `cron:${expression}:${scheduledFor}`,
        triggerContext: {
          type: "cron",
          expression,
          scheduledFor,
          dispatchedAt: now.toISOString(),
          timeZone: APP_TIME_ZONE,
        },
      });
      return {
        dispatched: queued.created,
        advanced: true,
        audit: {
          playbookId: playbook.id,
          playbookName: playbook.name,
          runId: queued.run.id,
          scheduledFor,
          nextRunAt: nextRunAt.toISOString(),
          expression,
        },
      };
    });
    if (outcome.dispatched && outcome.audit) {
      await recordTriggerAudit("playbook.trigger.cron", outcome.audit);
    }
    return { dispatched: outcome.dispatched, advanced: outcome.advanced };
  } finally {
    await release();
  }
}

export async function initializeUnscheduledCronPlaybooks(now: Date = new Date()): Promise<number> {
  const rows = await prisma.playbook.findMany({
    where: { enabled: true, triggerType: "cron", nextRunAt: null },
    select: { id: true },
    take: MAX_TRIGGER_PLAYBOOKS_PER_TICK,
  });
  let initialized = 0;
  for (const row of rows) {
    if (await initializeCronPlaybookSchedule(row.id, now)) initialized += 1;
  }
  return initialized;
}

export async function dispatchDueCronPlaybooks(now: Date = new Date()): Promise<{
  dispatched: number;
  advanced: number;
}> {
  const rows = await prisma.playbook.findMany({
    where: {
      enabled: true,
      triggerType: "cron",
      nextRunAt: { not: null, lte: now },
    },
    select: { id: true, nextRunAt: true },
    take: MAX_TRIGGER_PLAYBOOKS_PER_TICK,
    orderBy: { nextRunAt: "asc" },
  });
  let dispatched = 0;
  let advanced = 0;
  for (const row of rows) {
    if (!row.nextRunAt) continue;
    const outcome = await dispatchDueCronPlaybook({
      playbookId: row.id,
      dueAt: row.nextRunAt,
      now,
    });
    if (outcome.dispatched) dispatched += 1;
    if (outcome.advanced) advanced += 1;
  }
  return { dispatched, advanced };
}

function metricTriggerKey(config: MetricTriggerConfig, transitions: Array<{
  serverId: string;
  sampleAt: string;
}>): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ metric: config.metric, operator: config.operator, threshold: config.threshold, transitions }))
    .digest("hex");
  return `metric:${config.metric}:${digest}`;
}

/**
 * Evaluate metric triggers from one fresh health collection. Matching is
 * scoped to the playbook's team and records an edge per server; a sustained
 * high CPU value therefore does not enqueue the same remediation every five
 * minutes. Multiple servers crossing in one sample are bundled into one run.
 */
export async function dispatchMetricPlaybooksForHealthOverview(
  servers: ServerHealth[],
  now: Date = new Date(),
): Promise<{ dispatched: number; evaluated: number }> {
  const candidates = servers.filter((server) =>
    server.enabled
    && (typeof server.cpu === "number" || typeof server.mem === "number" || typeof server.diskMax === "number"),
  );
  if (candidates.length === 0) return { dispatched: 0, evaluated: 0 };

  const serverRows = await prisma.server.findMany({
    where: { id: { in: candidates.map((server) => server.serverId) } },
    select: { id: true, teamId: true },
  });
  const teamByServerId = new Map(serverRows.map((server) => [server.id, server.teamId ?? null]));
  const readings: TriggerReading[] = candidates.flatMap((server) => {
    const teamId = teamByServerId.get(server.serverId);
    if (teamId === undefined) return [];
    const sampledAt = Number.isFinite(Date.parse(server.lastCheck))
      ? new Date(server.lastCheck).toISOString()
      : now.toISOString();
    return [{
      serverId: server.serverId,
      teamId,
      cpu: server.cpu,
      mem: server.mem,
      diskMax: server.diskMax,
      sampleAt: sampledAt,
    }];
  });
  if (readings.length === 0) return { dispatched: 0, evaluated: 0 };

  const playbooks = await prisma.playbook.findMany({
    where: { enabled: true, triggerType: "metric" },
    select: { id: true, teamId: true },
    take: MAX_TRIGGER_PLAYBOOKS_PER_TICK,
  });
  let dispatched = 0;
  let evaluated = 0;
  for (const playbook of playbooks) {
    const teamReadings = readings.filter((reading) => reading.teamId === (playbook.teamId ?? null));
    if (teamReadings.length === 0) continue;
    evaluated += 1;
    if (await dispatchMetricPlaybook({ playbookId: playbook.id, readings: teamReadings, now })) {
      dispatched += 1;
    }
  }
  return { dispatched, evaluated };
}

async function dispatchMetricPlaybook(input: {
  playbookId: string;
  readings: TriggerReading[];
  now: Date;
}): Promise<boolean> {
  const release = await tryAcquireAdvisoryLock("playbook-lifecycle", input.playbookId);
  if (!release) return false;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const playbook = await tx.playbook.findUnique({ where: { id: input.playbookId } });
      if (
        !playbook
        || !playbook.enabled
        || playbook.triggerType !== "metric"
        || !isMetricTriggerConfig(playbook.triggerConfig)
      ) {
        return { dispatched: false, audit: null as AuditDetail | null };
      }

      const config = playbook.triggerConfig;
      const state = parseMetricMatchState(playbook.metricMatchState);
      const transitions: Array<{ serverId: string; value: number; sampleAt: string }> = [];
      let stateChanged = false;
      for (const reading of input.readings) {
        const value = metricValueForTrigger(config.metric, reading);
        if (value === undefined || !Number.isFinite(value)) continue;
        const previous = state[reading.serverId];
        const previousAt = previous ? Date.parse(previous.sampleAt) : Number.NEGATIVE_INFINITY;
        const sampleAt = Date.parse(reading.sampleAt);
        if (!Number.isFinite(sampleAt) || sampleAt <= previousAt) continue;

        const breached = metricMatchesThreshold(value, config.operator, config.threshold);
        state[reading.serverId] = { breached, sampleAt: new Date(sampleAt).toISOString(), value };
        stateChanged = true;
        if (breached && !previous?.breached) {
          transitions.push({ serverId: reading.serverId, value, sampleAt: new Date(sampleAt).toISOString() });
        }
      }
      if (!stateChanged) return { dispatched: false, audit: null as AuditDetail | null };

      if (transitions.length === 0) {
        await tx.playbook.update({
          where: { id: playbook.id },
          data: { metricMatchState: state as unknown as Prisma.InputJsonValue },
        });
        return { dispatched: false, audit: null as AuditDetail | null };
      }

      const queued = await queuePlaybookRunWithClient({
        client: tx,
        playbook: queueablePlaybook(playbook),
        dryRun: false,
        createdById: playbook.createdById,
        triggerKey: metricTriggerKey(config, transitions.map(({ serverId, sampleAt }) => ({ serverId, sampleAt }))),
        triggerContext: {
          type: "metric",
          metric: config.metric,
          operator: config.operator,
          threshold: config.threshold,
          readings: transitions,
          sampledAt: input.now.toISOString(),
        },
      });
      await tx.playbook.update({
        where: { id: playbook.id },
        data: {
          metricMatchState: state as unknown as Prisma.InputJsonValue,
          lastTriggeredAt: input.now,
        },
      });
      return {
        dispatched: queued.created,
        audit: {
          playbookId: playbook.id,
          playbookName: playbook.name,
          runId: queued.run.id,
          metric: config.metric,
          operator: config.operator,
          threshold: config.threshold,
          readings: transitions,
        },
      };
    });
    if (outcome.dispatched && outcome.audit) {
      await recordTriggerAudit("playbook.trigger.metric", outcome.audit);
    }
    return outcome.dispatched;
  } finally {
    await release();
  }
}
