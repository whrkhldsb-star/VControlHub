import { canReceivePlaybookNotification } from "./notification-recipient";
import { canAlertRuleTargetTeam } from "@/lib/alert/rule-scope";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-023 M04: Playbook service — CRUD + chain execution entry point.
 *
 * Pattern mirrors `command-template/service.ts`: thin Prisma wrapper that
 * returns narrowed `PlaybookRecord` / `PlaybookRunRecord` shapes so callers
 * (UI, API routes, executor) never have to re-parse the `triggerConfig`
 * or `steps` JSON columns.
 */

import { Prisma } from "@prisma/client";
import { activeCustomerTeamWhere, isGlobalTeamManager, liveCustomerRowsWhere, lockLiveCustomer, playbookTeamWhere, rawActiveCustomerScope, serverTeamWhere, teamCreateData, type TeamSession } from "@/lib/auth/team-scope";

import { prisma } from "@/lib/db";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { NotFoundError, ValidationError, BusinessError, ForbiddenError } from "@/lib/errors";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PLAYBOOK_APPROVAL_PERMISSION, PLAYBOOK_COMMAND_PERMISSION, PLAYBOOK_RUN_PERMISSION } from "./permissions";

import type {
  CreatePlaybookInput,
  UpdatePlaybookInput,
} from "./schema";
import { t } from "@/lib/i18n/service-translations";
import type {
  PlaybookRecord,
  PlaybookRunRecord,
  PlaybookStep,
  TriggerConfig,
  TriggerType,
} from "./types";
import {
  assertValidPlaybookTriggerConfig,
  computeNextPlaybookCronRun,
  isCronTriggerConfig,
  isMetricTriggerConfig,
  normalizePlaybookCronExpression,
} from "./trigger-utils";
import { queuePlaybookRunWithClient } from "./run-queue";
import { projectTriggerContexts } from "./trigger-context";
import { projectWebhookConfig, redactRunHistory } from "./webhook-result";
import { toJsonValue } from "@/lib/db/json";

/**
 * Reject playbook steps that target servers outside the caller's team.
 * Defense-in-depth: executor also scopes createCommandRequest by teamId,
 * but validation at write-time prevents storing an IDOR payload that would
 * later fail (or worse, succeed under a stale null teamId stamp).
 */
async function assertPlaybookCommandServersInScope(
  steps: PlaybookStep[],
  session?: TeamSession | null,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const serverIds = [
    ...new Set(
      steps
        .filter((step): step is Extract<PlaybookStep, { type: "run_command" }> => step.type === "run_command")
        .flatMap((step) => step.config.serverIds),
    ),
  ];
  if (serverIds.length === 0) return;

  const scope = session ? serverTeamWhere(session, "connect") : liveCustomerRowsWhere();
  const servers = await db.server.findMany({
    where: { id: { in: serverIds }, ...scope },
    select: { id: true },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(
      apiCopy("apiCopy.one.or.more.playbook.command.targets.were.not.found.or.are.outsi.b0efee60"),
    );
  }
}

/**
 * Reject send_notification recipients outside the caller's user directory scope.
 * Without this, a team playbook author can store any userId and the worker will
 * create cross-tenant inbox rows (notification IDOR).
 */
async function assertPlaybookNotificationRecipientsInScope(steps: PlaybookStep[], teamId: string | null) {
  const recipients = new Set(steps.flatMap((step) => step.type === "send_notification" ? [step.config.recipientUserId] : []));
  for (const id of recipients) {
    if (!await canReceivePlaybookNotification(id, teamId)) {
      throw new ValidationError(apiCopy("apiCopy.one.or.more.playbook.notification.recipients.were.not.found.or.a.69400842"));
    }
  }
}

/**
 * A playbook with run_command steps is a command-execution vector. Require the
 * author to actually hold command:execute so `playbook:manage` alone cannot be
 * used to author (and later auto-trigger) command execution — closing the
 * permission-decoupling bypass. The worker also re-checks at execution time
 * (defense in depth), but rejecting at write time gives immediate feedback.
 */
function assertPlaybookCommandAuthoring(
  steps: PlaybookStep[],
  session?: TeamSession | null,
): void {
  if (!session) return;
  const hasCommandStep = steps.some((step) => step.type === "run_command");
  if (hasCommandStep && !sessionHasPermission(session, PLAYBOOK_COMMAND_PERMISSION)) {
    throw new ForbiddenError(
      apiCopy("apiCopy.playbooks.with.command.steps.require.the.command.execute.permiss.e411b7bc"),
    );
  }
}

export async function assertPlaybookCommandStepsInScope(
  steps: PlaybookStep[],
  session?: TeamSession | null,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  assertPlaybookCommandAuthoring(steps, session);
  await assertPlaybookCommandServersInScope(steps, session, db);
}

async function assertPlaybookStepsInScope(steps: PlaybookStep[], teamId: string | null, session?: TeamSession | null): Promise<void> {
  await assertPlaybookCommandStepsInScope(steps, session);
  await assertPlaybookNotificationRecipientsInScope(steps, teamId);
}

type RawPlaybook = {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  steps: unknown;
  chainRetry: number;
  enabled: boolean;
  nextRunAt: Date | null;
  lastTriggeredAt: Date | null;
  metricMatchState: unknown;
  createdById: string | null;
  teamId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawPlaybookRun = {
  id: string;
  playbookId: string;
  status: string;
  dryRun: boolean;
  triggerContext: unknown;
  triggerKey: string | null;
  stepResults: unknown;
  executionState: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const creatorSelect = {
  status: true, mustChangePassword: true,
  roles: { where: { role: { key: "admin" } }, select: { roleId: true } },
  teamMembership: { select: { teamId: true, team: { select: { deletedAt: true } }, identityTemplate: { select: { permissions: true } } } },
} satisfies Prisma.UserSelect;

type Creator = Prisma.UserGetPayload<{ select: typeof creatorSelect }>;

function ownerIsActive(creator: Creator | null | undefined, teamId: string | null) {
  if (!creator || creator.status === "DISABLED" || creator.mustChangePassword) return false;
  if (creator.roles.length) return true;
  const membership = creator.teamMembership;
  return Boolean(membership && membership.teamId === teamId && !membership.team.deletedAt
    && membership.identityTemplate.permissions.includes(PLAYBOOK_RUN_PERMISSION));
}

function narrowPlaybook(row: RawPlaybook & { creator?: Creator | null }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType as TriggerType,
    triggerConfig: row.triggerConfig as TriggerConfig,
    steps: row.steps as PlaybookStep[],
    chainRetry: row.chainRetry,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastTriggeredAt: row.lastTriggeredAt,
    createdById: row.createdById,
    teamId: row.teamId,
    ownerActive: ownerIsActive(row.creator, row.teamId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mayReadCommandSteps(session?: TeamSession | null) {
  return Boolean(session && (sessionHasPermission(session, PLAYBOOK_COMMAND_PERMISSION) || sessionHasPermission(session, PLAYBOOK_APPROVAL_PERMISSION)));
}

function projectPlaybook(playbook: PlaybookRecord, session?: TeamSession | null) {
  const showWebhook = session && sessionHasPermission(session, "playbook:manage");
  const showCommand = mayReadCommandSteps(session);
  return {
    ...playbook,
    steps: (Array.isArray(playbook.steps) ? playbook.steps : []).filter((step) => step?.type).map((step) => {
      if (step.type === "run_command" && !showCommand) {
        return { id: step.id, type: step.type, name: step.name, retry: step.retry, timeoutSec: step.timeoutSec, config: {} };
      }
      if (step.type !== "call_webhook" || showWebhook) return step;
      const config = projectWebhookConfig(step);
      return {
        id: step.id, name: /https?:\/\//i.test(step.name) ? `${config.method} ${config.host}` : step.name,
        type: step.type, retry: step.retry, timeoutSec: step.timeoutSec, config,
      };
    }),
  };
}

function narrowPlaybookRun(row: RawPlaybookRun, triggerContext = row.triggerContext, showCommands = false): PlaybookRunRecord {
  return {
    id: row.id,
    playbookId: row.playbookId,
    status: row.status as PlaybookRunRecord["status"],
    dryRun: row.dryRun,
    triggerContext,
    triggerKey: row.triggerKey,
    ...redactRunHistory(row.executionState, row.stepResults, row.errorMessage, showCommands),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPlaybooks(session?: TeamSession, page?: { after?: string; take: number }) {
  const where = session ? activeCustomerTeamWhere(session) : liveCustomerRowsWhere();
  const rows = await prisma.playbook.findMany({
    where: { ...where, ...(page?.after ? { id: { lt: page.after } } : {}) },
    orderBy: page ? { id: "desc" } : [{ createdAt: "desc" }, { id: "desc" }],
    take: page?.take,
    include: { creator: { select: creatorSelect } },
  });
  return rows.map((row) => projectPlaybook(narrowPlaybook(row), session));
}

async function getPlaybookDefinition(
  id: string,
  session?: TeamSession | null,
) {
  const where = session ? activeCustomerTeamWhere(session) : liveCustomerRowsWhere();
  const row = await prisma.playbook.findFirst({ where: { id, ...where }, include: { creator: { select: creatorSelect } } });
  return row ? narrowPlaybook(row) : null;
}

export async function getPlaybook(id: string, session?: TeamSession | null) {
  const playbook = await getPlaybookDefinition(id, session);
  return playbook ? projectPlaybook(playbook, session) : null;
}

export async function createPlaybook(
  input: CreatePlaybookInput,
  createdById: string,
  session?: TeamSession | null,
) {
  // The create schema supports cron and metric triggers, both automatic when enabled.
  if (input.enabled && session && !sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION)) {
    throw new ForbiddenError(t("backend.playbook.triggerChangeRequiresRun"));
  }
  await assertPlaybookStepsInScope(input.steps as PlaybookStep[], session?.currentTeamId ?? null, session);
  try {
    assertValidPlaybookTriggerConfig(input.triggerType, input.triggerConfig);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
  const triggerConfig = input.triggerType === "cron" && isCronTriggerConfig(input.triggerConfig)
    ? { expression: normalizePlaybookCronExpression(input.triggerConfig.expression) }
    : input.triggerConfig;
  const nextRunAt = input.enabled && input.triggerType === "cron" && isCronTriggerConfig(triggerConfig)
    ? computeNextPlaybookCronRun(triggerConfig.expression)
    : null;
  const teamData = session ? teamCreateData(session) : {};
  const row = await prisma.$transaction(async tx => {
    if (teamData.teamId) await lockLiveCustomer(tx, teamData.teamId);
    return tx.playbook.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        triggerType: input.triggerType,
        triggerConfig: toJsonValue(triggerConfig),
        steps: toJsonValue(input.steps),
        chainRetry: input.chainRetry,
        enabled: input.enabled,
        nextRunAt,
        createdById,
        ...teamData,
      },
      include: { creator: { select: creatorSelect } },
    });
  });
  const narrowed = narrowPlaybook(row);
  // Stamp the customer: an audit row left at `teamId: null` is treated as
  // shared/legacy data by `teamWhere` and shown to every tenant, and a playbook
  // name is tenant-authored content.
  await auditUserAction(
    createdById,
    "playbook.create",
    {
      playbookId: narrowed.id,
      name: narrowed.name,
      triggerType: narrowed.triggerType,
      stepCount: narrowed.steps.length,
      chainRetry: narrowed.chainRetry,
    },
    undefined,
    row.teamId ?? null,
  );
  return projectPlaybook(narrowed, session);
}

function sameTriggerConfig(a: TriggerConfig, b: TriggerConfig) {
  if (isCronTriggerConfig(a) && isCronTriggerConfig(b)) return a.expression.trim().split(/\s+/).join(" ") === b.expression.trim().split(/\s+/).join(" ");
  return isMetricTriggerConfig(a) && isMetricTriggerConfig(b)
    && a.metric === b.metric && a.operator === b.operator && a.threshold === b.threshold;
}

async function hasAutomaticTrigger(db: Prisma.TransactionClient, id: string, triggerType: string): Promise<boolean> {
  // Imports and legacy rows can carry a manual trigger. Alert rules can still start those by id.
  if (triggerType !== "manual") return true;
  return Boolean(await db.alertRule.findFirst({ where: { playbookIds: { has: id } }, select: { id: true } }));
}

async function updatePlaybookWithoutRunPermission(tx: Prisma.TransactionClient, where: Prisma.PlaybookWhereInput, data: Prisma.PlaybookUncheckedUpdateManyInput) {
  // Legacy importers can write without the lifecycle lock. Recheck unattended triggers
  // on the same serializable snapshot as the restricted edit.
  const current = await tx.playbook.findFirst({ where, select: { id: true, enabled: true, triggerType: true } });
  if (!current) throw new NotFoundError(t("backend.playbook.notFound"));
  if (current.enabled && await hasAutomaticTrigger(tx, current.id, current.triggerType)) {
    throw new ForbiddenError(t("backend.playbook.triggerChangeRequiresRun"));
  }
  return tx.playbook.updateMany({ where, data });
}

export async function updatePlaybook(
  input: UpdatePlaybookInput,
  updatedById: string,
  session?: TeamSession | null,
) {
  const { id, ...rest } = input;
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", id);
  let narrowed: ReturnType<typeof narrowPlaybook>;
  try {
    const existing = await getPlaybookDefinition(id, session);
    if (!existing) throw new NotFoundError(t("backend.playbook.notFound"));
    const effectiveTriggerType = rest.triggerType ?? existing.triggerType;
    const effectiveTriggerConfig = (rest.triggerConfig ?? existing.triggerConfig) as TriggerConfig;
    const effectiveEnabled = rest.enabled ?? existing.enabled;
    const triggerProvided = rest.triggerType !== undefined || rest.triggerConfig !== undefined;
    const triggerChanged = triggerProvided && (effectiveTriggerType !== existing.triggerType
      || !sameTriggerConfig(effectiveTriggerConfig, existing.triggerConfig));
    const schedulingChanged = triggerChanged || rest.enabled !== undefined || rest.chainRetry !== undefined;
    const lacksRun = session && !sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION);
    // Unattended runs use the owner's authority, including when the caller only edits the steps.
    if (session && (schedulingChanged || (effectiveEnabled && await hasAutomaticTrigger(prisma, id, effectiveTriggerType)))) {
      if (lacksRun) {
        throw new ForbiddenError(t("backend.playbook.triggerChangeRequiresRun"));
      }
      if (rest.steps === undefined) await assertPlaybookCommandStepsInScope(existing.steps, session);
    }
    if (rest.steps !== undefined) {
      await assertPlaybookStepsInScope(rest.steps as PlaybookStep[], existing.teamId, session);
    }
    // Taking a playbook over makes its runs act as the claimer. It is meant for an orphaned one (R0-07); a live
    // owner's playbook only changes hands through a platform administrator.
    if (rest.claimOwnership && session && !sessionHasPermission(session, PLAYBOOK_RUN_PERMISSION)) throw new ForbiddenError(t("backend.playbook.triggerChangeRequiresRun"));
    if (rest.claimOwnership && session && !isGlobalTeamManager(session) && existing.createdById !== session.userId) {
      if (existing.ownerActive) throw new ForbiddenError(t("backend.playbook.claimRequiresAdmin"));
    }
    if (triggerProvided) {
      try {
        assertValidPlaybookTriggerConfig(effectiveTriggerType, effectiveTriggerConfig);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
    }
    const normalizedTriggerConfig = triggerProvided && effectiveTriggerType === "cron" && isCronTriggerConfig(effectiveTriggerConfig)
      ? { expression: normalizePlaybookCronExpression(effectiveTriggerConfig.expression) }
      : effectiveTriggerConfig;
    const data: Prisma.PlaybookUncheckedUpdateManyInput = {};
    if (rest.name !== undefined) data.name = rest.name;
    // A playbook whose creator is gone runs as nobody; an administrator takes it over (R0-07).
    if (rest.claimOwnership) data.createdById = updatedById;
    if (rest.description !== undefined) data.description = rest.description;
    if (rest.triggerType !== undefined) data.triggerType = rest.triggerType;
    if (rest.triggerConfig !== undefined) {
      data.triggerConfig = toJsonValue(normalizedTriggerConfig);
    }
    if (rest.steps !== undefined) {
      data.steps = toJsonValue(rest.steps);
    }
    if (rest.chainRetry !== undefined) data.chainRetry = rest.chainRetry;
    if (rest.enabled !== undefined) data.enabled = rest.enabled;
    if (triggerChanged || rest.enabled !== undefined) {
      data.nextRunAt = effectiveEnabled && effectiveTriggerType === "cron" && isCronTriggerConfig(normalizedTriggerConfig)
        ? computeNextPlaybookCronRun(normalizedTriggerConfig.expression)
        : null;
    }
    if (triggerChanged) data.metricMatchState = Prisma.DbNull;
    const where = { id, ...(session ? activeCustomerTeamWhere(session) : liveCustomerRowsWhere()), teamId: existing.teamId, updatedAt: existing.updatedAt };
    const updated = await prisma.$transaction(async tx => {
      if (existing.teamId) await lockLiveCustomer(tx, existing.teamId);
      return lacksRun ? updatePlaybookWithoutRunPermission(tx, where, data) : tx.playbook.updateMany({ where, data });
    }, { isolationLevel: "Serializable" });
    if (updated.count === 0) throw new NotFoundError(t("backend.playbook.notFound"));
    const row = await getPlaybookDefinition(id, session);
    if (!row || row.teamId !== existing.teamId) throw new NotFoundError(t("backend.playbook.notFound"));
    narrowed = row;
  } finally {
    await releaseLock();
  }
  await auditUserAction(
    updatedById,
    "playbook.update",
    {
      playbookId: narrowed.id,
      name: narrowed.name,
      enabled: narrowed.enabled,
      stepCount: narrowed.steps.length,
    },
    undefined,
    narrowed.teamId,
  );
  return projectPlaybook(narrowed, session);
}

export async function reconcileTerminalPlaybookJobs(db: Prisma.TransactionClient, scope?: { playbookId?: string; jobId?: string }) {
  return db.$executeRaw`UPDATE playbook_runs r
    SET status = CASE WHEN j.status = 'CANCELLED' THEN 'cancelled'
                      WHEN j.status = 'COMPLETED' AND COALESCE(j.result->>'status', '') <> 'failed' THEN 'completed'
                      ELSE 'failed' END::"PlaybookRunStatus",
        "errorMessage" = CASE WHEN j.status = 'FAILED' OR j.result->>'status' = 'failed'
                              THEN ${t("backend.job.parentDurableJobAttemptsExhausted", "en")} ELSE NULL END,
        "completedAt" = COALESCE(j."completedAt", now()), "updatedAt" = now()
    FROM jobs j WHERE r."jobId" = j.id AND j.type = 'playbook.run'
      AND r.status IN ('queued', 'running') AND j.status IN ('FAILED', 'CANCELLED', 'COMPLETED')
      ${scope?.playbookId ? Prisma.sql`AND r."playbookId" = ${scope.playbookId}` : Prisma.empty}
      ${scope?.jobId ? Prisma.sql`AND j.id = ${scope.jobId}` : Prisma.empty}`;
}

export async function deletePlaybook(
  id: string,
  deletedById: string,
  session?: TeamSession | null,
): Promise<void> {
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", id);
  let auditTeamId: string | null;
  try {
    auditTeamId = await prisma.$transaction(async (tx) => {
      const where = { id, ...(session ? activeCustomerTeamWhere(session) : liveCustomerRowsWhere()) };
      const existing = await tx.playbook.findFirst({ where, select: { teamId: true } });
      if (!existing) throw new NotFoundError(t("backend.playbook.notFound"));
      if (existing.teamId) await lockLiveCustomer(tx, existing.teamId);
      await reconcileTerminalPlaybookJobs(tx, { playbookId: id });
      const activeRun = await tx.playbookRun.findFirst({
        where: { playbookId: id, status: { in: ["queued", "running"] } }, select: { id: true },
      });
      if (activeRun) throw new BusinessError(t("backend.playbook.cannotDeleteWhileRunning"));
      const deleted = await tx.playbook.deleteMany({ where: { ...where, teamId: existing.teamId } });
      if (!deleted.count) throw new NotFoundError(t("backend.playbook.notFound"));
      // Alert rules name their remediation playbooks by id, without a foreign
      // key: a deleted one stayed listed (and counted on the rule's card) and
      // every later fire tried to start it.
      await tx.$executeRaw`UPDATE "alert_rules" SET "playbookIds" = array_remove("playbookIds", ${id}) WHERE ${id} = ANY("playbookIds")`;
      return existing.teamId;
    });
  } finally {
    await releaseLock();
  }
  await auditUserAction(
    deletedById,
    "playbook.delete",
    { playbookId: id },
    undefined,
    auditTeamId,
  );
}

async function projectRuns(rows: RawPlaybookRun[], session?: TeamSession): Promise<PlaybookRunRecord[]> {
  const contexts = session && await projectTriggerContexts(rows.map((row) => row.triggerContext), session);
  return rows.map((row, index) => narrowPlaybookRun(row, contexts ? contexts[index] : row.triggerContext, mayReadCommandSteps(session)));
}

export async function getPlaybookRun(id: string, session: TeamSession): Promise<PlaybookRunRecord | null> {
  const scope = playbookTeamWhere(session);
  const row = await prisma.playbookRun.findFirst({ where: { AND: [{ id }, scope, { playbook: scope }] } });
  if (!row) return null;
  const [run] = await projectRuns([row], session);
  return run ?? null;
}

export async function listPlaybookRuns(
  playbookId: string,
  session?: TeamSession,
): Promise<PlaybookRunRecord[]> {
  // Ensure the parent playbook itself is in scope before leaking run history.
  if (session) {
    const playbook = await getPlaybookDefinition(playbookId, session);
    if (!playbook) throw new NotFoundError(t("backend.playbook.notFound"));
  }
  const rows = await prisma.playbookRun.findMany({
    where: { playbookId, ...(session ? playbookTeamWhere(session) : liveCustomerRowsWhere()), playbook: session ? playbookTeamWhere(session) : liveCustomerRowsWhere() },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return projectRuns(rows, session);
}

/**
 * Persist a queued run and enqueue the durable parent job. The API returns
 * immediately; the playbook worker owns execution, retries and recovery.
 */
/** Batch-load recent runs for many playbooks (avoids N+1 getPlaybook+findMany). */
export async function listRecentPlaybookRunsForPlaybooks(
  playbookIds: string[],
  session?: TeamSession,
  perPlaybook = 5,
): Promise<Record<string, PlaybookRunRecord[]>> {
  const out: Record<string, PlaybookRunRecord[]> = {};
  for (const id of playbookIds) out[id] = [];
  if (playbookIds.length === 0) return out;
  // The newest `perPlaybook` runs of EACH playbook, ranked in the database.
  // One newest-first window over all of them (playbooks × perPlaybook rows)
  // was filled by a busy playbook, and the others showed no history at all.
  const ranked = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "playbookId" ORDER BY "createdAt" DESC, id DESC) AS position
      FROM playbook_runs
      WHERE "playbookId" = ANY(${playbookIds}::text[])
        AND EXISTS (SELECT 1 FROM playbooks p WHERE p.id = playbook_runs."playbookId" AND p."teamId" IS NOT DISTINCT FROM playbook_runs."teamId")
        ${session ? Prisma.sql`AND ${rawActiveCustomerScope(session, Prisma.sql`playbook_runs."teamId"`)}` : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = playbook_runs."teamId" AND t."deletedAt" IS NOT NULL)`}
    ) ranked
    WHERE position <= ${perPlaybook}`;
  const rows = await prisma.playbookRun.findMany({
    where: {
      id: { in: ranked.map((row) => row.id) },
      ...(session ? playbookTeamWhere(session) : liveCustomerRowsWhere()),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const row of await projectRuns(rows, session)) {
    const list = out[row.playbookId] ?? (out[row.playbookId] = []);
    if (list.length >= perPlaybook) continue;
    list.push(row);
  }
  return out;
}

export async function runPlaybook(input: {
  playbookId: string;
  dryRun: boolean;
  triggerContext?: unknown;
  createdById?: string;
  session?: TeamSession;
  sourceAlertTeamId?: string | null;
  sourceAlertServerId?: string;
}): Promise<PlaybookRunRecord> {
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", input.playbookId);
  let narrowedPlaybook: PlaybookRecord;
  let run: RawPlaybookRun;
  const requesterId = input.session?.userId ?? input.createdById ?? null;
  // The run belongs to the playbook's customer, which is not necessarily the
  // caller's current one (a platform administrator can queue across customers).
  let auditTeamId: string | null = null;
  try {
    const scope = input.session ? playbookTeamWhere(input.session) : liveCustomerRowsWhere();
    const playbook = await prisma.playbook.findFirst({
      where: { id: input.playbookId, ...scope },
    });
    if (!playbook || !canAlertRuleTargetTeam(input.sourceAlertTeamId, playbook.teamId)) {
      throw new NotFoundError(
        t("backend.playbook.notFoundWithId", { id: input.playbookId }),
      );
    }
    narrowedPlaybook = narrowPlaybook(playbook);
    auditTeamId = playbook.teamId ?? null;
    if (!narrowedPlaybook.enabled) {
      throw new BusinessError(
        t("backend.playbook.disabledWithId", { id: input.playbookId }),
      );
    }

    if (input.session && !input.dryRun) {
      await assertPlaybookCommandStepsInScope(narrowedPlaybook.steps, input.session);
    }
    const queued = await prisma.$transaction((tx) =>
      queuePlaybookRunWithClient({
        client: tx,
        playbook: {
          id: playbook.id,
          name: playbook.name,
          steps: narrowedPlaybook.steps,
          chainRetry: playbook.chainRetry,
          createdById: playbook.createdById,
          teamId: playbook.teamId ?? null,
        },
        dryRun: input.dryRun,
        triggerContext: input.triggerContext,
        sourceAlert: input.sourceAlertTeamId === undefined ? undefined : { serverId: input.sourceAlertServerId, teamId: input.sourceAlertTeamId },
        createdById: requesterId,
      }),
    );
    run = queued.run;
  } finally {
    await releaseLock();
  }

  if (requesterId) {
    await auditUserAction(
      requesterId,
      input.dryRun ? "playbook.dry-run" : "playbook.run",
      {
        playbookId: input.playbookId,
        runId: run.id,
        dryRun: input.dryRun,
        status: "queued",
        stepCount: narrowedPlaybook.steps.length,
      },
      undefined,
      auditTeamId,
    );
  }
  return narrowPlaybookRun(run, run.triggerContext, mayReadCommandSteps(input.session));
}
