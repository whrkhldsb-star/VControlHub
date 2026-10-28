import { apiCopy } from "@/lib/i18n/api-copy";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import type { CommandRequestStatus } from "@prisma/client";
import { createCommandRequest } from "@/lib/command/service";
import { BusinessError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { notifyTaskConsecutiveFailed } from "@/lib/notification/service";
import { createLogger } from "@/lib/logging";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere, isGlobalTeamManager, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { t } from "@/lib/i18n/service-translations";
import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";

const taskLogger = createLogger("scheduled-task");

/* ── Types ────────────────────────────────────────────────── */

// `permissions` is what the identity template grants; without it the role defaults apply, so callers that hold a
// full session should pass it on.
export type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> & Partial<Pick<SessionPayload, "permissions">>;

export type CreateScheduledTaskInput = {
	name: string;
	cronExpression?: string;
	scheduleType?: "CRON" | "ONCE";
	runAt?: Date | string | null;
	command: string;
	reason?: string;
	plan?: string;
	verificationCommand?: string;
	rollbackCommand?: string;
	approvalRequired?: boolean;
	source?: string;
	templateId?: string | null;
	serverIds: string[];
	createdById?: string;
	/** Optional explicit team; defaults to session.currentTeamId when session is provided. */
	teamId?: string | null;
};

export type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput> & {
	status?: "ACTIVE" | "PAUSED" | "DISABLED";
};

const ONCE_CRON_PLACEHOLDER = "0 0 1 1 *";

function resolveSchedule(input: Pick<CreateScheduledTaskInput, "scheduleType" | "cronExpression" | "runAt">) {
	const scheduleType = input.scheduleType ?? "CRON";
	if (scheduleType === "ONCE") {
		const runAt = input.runAt instanceof Date ? input.runAt : new Date(input.runAt ?? "");
		if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
			throw new ValidationError(t("backend.scheduled-task.futureOnce"));
		}
		return { scheduleType, cronExpression: input.cronExpression ?? ONCE_CRON_PLACEHOLDER, runAt, nextRunAt: runAt } as const;
	}
	if (!input.cronExpression?.trim()) throw new ValidationError(t("backend.scheduled-task.invalidCronExpression"));
	// The documented format has five fields. cron-parser also takes six (seconds) and macros such as "@daily"; the
	// minute tick turned a per-second expression into "every minute", and only the form checked this. Rows saved
	// earlier are not touched: computeNextRun still accepts whatever they hold.
	if (input.cronExpression.trim().split(/\s+/).length !== 5) throw new ValidationError(t("backend.scheduled-task.invalidCronExpression"));
	return {
		scheduleType,
		cronExpression: input.cronExpression.trim(),
		runAt: null,
		nextRunAt: computeNextRun(input.cronExpression),
	} as const;
}

/* ── Compute next run time ────────────────────────────────── */

export function computeNextRun(cronExpression: string, from: Date = new Date()): Date {
	try {
		const interval = CronExpressionParser.parse(cronExpression, {
			currentDate: from,
			tz: APP_TIME_ZONE,
		});
		return interval.next().toDate();
	} catch {
		throw new ValidationError(t("backend.scheduled-task.invalidCronExpression"));
	}
}

/* ── Helpers ──────────────────────────────────────────────── */

function normalizeServerIds(serverIds: string[]) {
	return Array.from(new Set(serverIds.map((id) => id.trim()).filter(Boolean)));
}

/**
 * Prevent scheduling commands against servers outside the caller's team.
 * Server roots use strict scope: legacy teamId=null rows are quarantined.
 */
async function assertScheduledTaskServersInScope(
	serverIds: string[],
	session?: SessionScope | null,
): Promise<void> {
	const ids = normalizeServerIds(serverIds);
	if (ids.length === 0 || !session) return;
	const scope = serverTeamWhere(session, "connect");
	// team:manage → empty scope, still verify servers exist
	const servers = await prisma.server.findMany({
		where: { id: { in: ids }, ...scope },
		select: { id: true },
	});
	if (servers.length !== ids.length) {
		throw new ValidationError(
			apiCopy("apiCopy.one.or.more.target.servers.were.not.found.or.are.outside.your.te.8f5645a2"),
		);
	}
}

/**
 * Load a scheduled task by id under optional team scope.
 * Used by mutate paths so cross-team IDs resolve as not-found (no IDOR).
 */
async function getScheduledTaskForSession(id: string, session: SessionScope) {
	return prisma.scheduledTask.findFirst({
		where: { id, ...teamWhere(session) },
	});
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createScheduledTask(
	input: CreateScheduledTaskInput,
	session: SessionScope,
) {
	const schedule = resolveSchedule(input);
	const teamFromSession = session ? teamCreateData(session).teamId : undefined;
	const teamId =
		input.teamId !== undefined ? input.teamId : (teamFromSession ?? null);
	const serverIds = normalizeServerIds(input.serverIds);
	if (serverIds.length === 0) {
		throw new ValidationError(t("backend.scheduled-task.atLeastOneTargetServer"));
	}
	await assertScheduledTaskServersInScope(serverIds, session);
	return prisma.scheduledTask.create({
		data: {
			name: input.name,
			cronExpression: schedule.cronExpression,
			scheduleType: schedule.scheduleType,
			runAt: schedule.runAt,
			command: input.command,
			reason: input.reason ?? null,
			plan: input.plan ?? null,
			verificationCommand: input.verificationCommand ?? null,
			rollbackCommand: input.rollbackCommand ?? null,
			approvalRequired: input.approvalRequired ?? true,
			source: input.source ?? "MANUAL",
			templateId: input.templateId ?? null,
			serverIds,
			createdById: input.createdById ?? session?.userId ?? null,
			nextRunAt: schedule.nextRunAt,
			teamId,
		},
	});
}

export async function listScheduledTasks(
	limit = 200,
	session: SessionScope,
) {
	return prisma.scheduledTask.findMany({
		where: teamWhere(session),
		orderBy: { createdAt: "desc" },
		take: limit,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function getScheduledTask(
	id: string,
	session: SessionScope,
) {
	const task = await getScheduledTaskForSession(id, session);
	if (!task) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	return task;
}

export async function updateScheduledTask(
	id: string,
	input: UpdateScheduledTaskInput,
	session: SessionScope,
) {
	const existing = await getScheduledTaskForSession(id, session);
	if (!existing) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));

	// An unattended task (approvalRequired=false) runs, as its creator and with nobody approving each run, what an
	// approver signed off on. Changing the command or its targets is that same decision, so it takes the same
	// permission: creating one and switching approval off already do. Without this a member who may only create
	// requests could rewrite the command of a task an approver set up and have it run unreviewed.
	if (!existing.approvalRequired && changesWhatRuns(existing, input) && !sessionHasPermission(session, "command:approve")) {
		throw new ForbiddenError(t("backend.scheduled-task.editUnattendedRequiresApprover"));
	}
	if (input.approvalRequired === false && existing.approvalRequired && !sessionHasPermission(session, "command:approve")) {
		throw new ForbiddenError(t("backend.scheduled-task.disableApprovalRequiresApprover"));
	}

	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.scheduleType !== undefined || input.cronExpression !== undefined || input.runAt !== undefined) {
		const schedule = resolveSchedule({
			scheduleType: input.scheduleType ?? existing.scheduleType,
			cronExpression: input.cronExpression ?? existing.cronExpression,
			runAt: input.runAt === undefined ? existing.runAt : input.runAt,
		});
		data.scheduleType = schedule.scheduleType;
		data.cronExpression = schedule.cronExpression;
		data.runAt = schedule.runAt;
		data.nextRunAt = schedule.nextRunAt;
		// A pending claim belongs to the old schedule's occurrence.
		data.claimedOccurrenceAt = null;
	}
	if (input.command !== undefined) data.command = input.command;
	if (input.reason !== undefined) data.reason = input.reason;
	if (input.plan !== undefined) data.plan = input.plan;
	if (input.verificationCommand !== undefined) data.verificationCommand = input.verificationCommand;
	if (input.rollbackCommand !== undefined) data.rollbackCommand = input.rollbackCommand;
	if (input.approvalRequired !== undefined) data.approvalRequired = input.approvalRequired;
	if (input.source !== undefined) data.source = input.source;
	if (input.templateId !== undefined) data.templateId = input.templateId;
	if (input.serverIds !== undefined) {
		const serverIds = normalizeServerIds(input.serverIds);
		if (serverIds.length === 0) {
			throw new ValidationError(
				t("backend.scheduled-task.atLeastOneTargetServer"),
			);
		}
		await assertScheduledTaskServersInScope(serverIds, session);
		data.serverIds = serverIds;
	}
	if (input.status !== undefined && input.status !== existing.status) {
		// The same transition as the toggle: resuming schedules the next run
		// (a resumed task kept nextRunAt null and never ran again), pausing
		// clears it; a pending claim belongs to the state before.
		Object.assign(data, statusTransitionData({
			status: input.status,
			scheduleType: (data.scheduleType as typeof existing.scheduleType | undefined) ?? existing.scheduleType,
			cronExpression: (data.cronExpression as string | undefined) ?? existing.cronExpression,
			runAt: data.runAt !== undefined ? (data.runAt as Date | null) : existing.runAt,
		}));
	} else if (input.status !== undefined) {
		data.status = input.status;
	}
	if (input.teamId !== undefined) {
		if (session && !isGlobalTeamManager(session) && input.teamId !== session.currentTeamId) {
			throw new ValidationError(t("backend.scheduled-task.teamChangeRequiresManager"));
		}
		data.teamId = input.teamId;
	}
	const updated = await prisma.scheduledTask.updateMany({
		where: { id, ...teamWhere(session) },
		data,
	});
	if (updated.count === 0) {
		throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	}
	return getScheduledTask(id, session);
}

/** Whether an edit changes what an unattended task runs, or where: the command and its target servers. */
function changesWhatRuns(
	existing: { command: string; serverIds: string[] },
	input: Pick<UpdateScheduledTaskInput, "command" | "serverIds">,
) {
	if (input.command !== undefined && input.command !== existing.command) return true;
	if (input.serverIds === undefined) return false;
	const next = normalizeServerIds(input.serverIds).sort();
	const current = [...existing.serverIds].sort();
	return next.length !== current.length || next.some((serverId, index) => serverId !== current[index]);
}

export async function deleteScheduledTask(
	id: string,
	session: SessionScope,
) {
	const existing = await getScheduledTaskForSession(id, session);
	if (!existing) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	const deleted = await prisma.scheduledTask.deleteMany({
		where: { id, ...teamWhere(session) },
	});
	if (deleted.count === 0) {
		throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	}
	return existing;
}

/**
 * The fields a status change sets. Resuming computes the next run (a ONCE
 * task whose time has passed cannot resume); pausing or disabling clears it.
 * Either way a pending claim belongs to the state before.
 */
function statusTransitionData(task: {
	status: "ACTIVE" | "PAUSED" | "DISABLED";
	scheduleType: string;
	cronExpression: string;
	runAt: Date | null;
}) {
	if (task.status !== "ACTIVE") return { status: task.status, nextRunAt: null, claimedOccurrenceAt: null };
	if (task.scheduleType === "ONCE" && (!task.runAt || task.runAt.getTime() <= Date.now())) {
		throw new BusinessError(t("backend.scheduled-task.completedCannotResume"));
	}
	return {
		status: task.status,
		nextRunAt: task.scheduleType === "ONCE" ? task.runAt : computeNextRun(task.cronExpression),
		claimedOccurrenceAt: null,
	};
}

export async function toggleScheduledTask(
	id: string,
	session: SessionScope,
) {
	const current = await getScheduledTaskForSession(id, session);
	if (!current) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	const newStatus = current.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
	const updated = await prisma.scheduledTask.updateMany({
		where: { id, ...teamWhere(session) },
		data: statusTransitionData({ ...current, status: newStatus }),
	});
	if (updated.count === 0) {
		throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	}
	return getScheduledTask(id, session);
}

export async function retryScheduledTask(
	id: string,
	session: SessionScope,
) {
	const task = await getScheduledTaskForSession(id, session);
	if (!task) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	if (task.serverIds.length === 0 || !task.createdById) {
		await recordTaskRun(task.id, t("backend.scheduled-task.manualRetryMissingTargetOrCreator"), "failed");
		throw new BusinessError(t("backend.scheduled-task.scheduledTaskMissingTargetServerOrCreatorCannot"));
	}
	// A retry of an unattended task runs at once, nobody approving it: starting that is executing a command.
	if (!task.approvalRequired && !sessionHasPermission(session, "command:execute")) {
		throw new ForbiddenError(t("backend.scheduled-task.retryUnattendedRequiresExecutor"));
	}

	// System path (no session on createCommandRequest): stamp teamId from the parent task.
	const result = await createCommandRequest({
		title: `Scheduled task retry: ${task.name}`,
		command: task.command,
		reason: task.reason ?? `Manually retry scheduled task ${task.name}`,
		submissionMode: "user",
		requesterId: task.createdById,
		serverIds: task.serverIds,
		teamId: task.teamId ?? null,
		approvalRequired: task.approvalRequired,
	});

	await recordTaskDispatch(task.id, result.id, true);
	return prisma.scheduledTask.findUniqueOrThrow({ where: { id } });
}

/**
 * The worker's claim on one occurrence: `nextRunAt` holds the lease and
 * `claimedOccurrenceAt` the occurrence. Editing the schedule replaces both.
 */
export interface ScheduledTaskClaim {
	occurrence: Date | null;
	lease: Date;
}

export async function recordTaskDispatch(id: string, commandRequestId: string, manual = false, claim?: ScheduledTaskClaim) {
	return prisma.$transaction(async (tx) => {
		const existing = await tx.scheduledTaskRun.findUnique({ where: { commandRequestId } });
		const task = await tx.scheduledTask.findUnique({
			where: { id },
			select: { cronExpression: true, scheduleType: true },
		});
		if (!task) return null;
		if (!existing) {
			const dispatchedAt = new Date();
			await tx.scheduledTaskRun.create({
				data: { scheduledTaskId: id, commandRequestId, manual, dispatchedAt },
			});
			await tx.scheduledTask.update({
				where: { id },
				data: {
					lastRunAt: dispatchedAt,
					lastResult: `${manual ? "Manual retry dispatched" : "Dispatched"} command request ${commandRequestId}; awaiting final result`,
					runCount: { increment: 1 },
				},
			});
			if (!manual) {
				// Advance only the schedule this dispatch claimed. An edit saved
				// meanwhile (a ONCE task moved to next week) replaced the claim, and
				// overwriting it disabled the task: the new run never happened.
				await tx.scheduledTask.updateMany({
					where: { id, ...(claim ? { nextRunAt: claim.lease, claimedOccurrenceAt: claim.occurrence } : {}) },
					data: {
						claimedOccurrenceAt: null,
						nextRunAt: task.scheduleType === "ONCE" ? null : computeNextRun(task.cronExpression),
						...(task.scheduleType === "ONCE" ? { status: "DISABLED" as const } : {}),
					},
				});
			}
		}
		return existing ?? { scheduledTaskId: id, commandRequestId, status: "DISPATCHED", manual };
	});
}

const TERMINAL_COMMAND_STATUSES = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"]);

export async function reconcileScheduledTaskRuns(limit = 500) {
	// Only runs whose request has finished: reading the oldest DISPATCHED
	// first let 500 requests waiting for approval hide every finished one.
	const pendingRuns = await prisma.scheduledTaskRun.findMany({
		where: { status: "DISPATCHED", commandRequest: { status: { in: [...TERMINAL_COMMAND_STATUSES] as CommandRequestStatus[] } } },
		orderBy: { dispatchedAt: "asc" },
		take: limit,
		include: {
			commandRequest: { select: { status: true } },
			scheduledTask: { select: { name: true, createdById: true, teamId: true } },
		},
	});
	let reconciled = 0;
	for (const run of pendingRuns) {
		const status = run.commandRequest.status;
		if (!TERMINAL_COMMAND_STATUSES.has(status)) continue;
		const failed = status !== "COMPLETED";
		const result = failed
			? `Execution failed: command request ${run.commandRequestId} ended as ${status}`
			: `Completed command request ${run.commandRequestId}`;
		const completedAt = new Date();
		// The run's outcome and the task's summary commit together: written
		// one after the other, a failed summary left the run finished and out
		// of this DISPATCHED scan for good, the task saying "awaiting result".
		let claimed: boolean;
		try {
			claimed = await prisma.$transaction(async (tx) => {
				const won = await tx.scheduledTaskRun.updateMany({
					where: { id: run.id, status: "DISPATCHED" },
					data: { status, result, completedAt },
				});
				if (won.count === 0) return false;
				await tx.scheduledTask.updateMany({
					where: {
						id: run.scheduledTaskId,
						OR: [{ lastRunAt: null }, { lastRunAt: { lte: run.dispatchedAt } }],
					},
					data: { lastResult: result },
				});
				return true;
			});
		} catch (error) {
			// Rolled back: the run stays DISPATCHED and the next pass retries it.
			taskLogger.warn("scheduled run outcome could not be recorded; retrying next pass", {
				runId: run.id,
				error: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		if (!claimed) continue;
		if (failed && run.scheduledTask.createdById) {
			const previous = await prisma.scheduledTaskRun.findFirst({
				where: {
					scheduledTaskId: run.scheduledTaskId,
					dispatchedAt: { lt: run.dispatchedAt },
					completedAt: { not: null },
				},
				orderBy: { dispatchedAt: "desc" },
				select: { status: true },
			});
			if (previous && previous.status !== "COMPLETED") {
				notifyTaskConsecutiveFailed(
					run.scheduledTask.createdById,
					run.scheduledTask.name,
					2,
					result.slice(0, 200),
					run.scheduledTask.teamId,
				).catch((err) => taskLogger.warn("notifyTaskConsecutiveFailed failed", { error: err instanceof Error ? err.message : String(err) }));
			}
		}
		reconciled += 1;
	}
	return { inspected: pendingRuns.length, reconciled };
}

/**
 * Structured outcome for {@link recordTaskRun}. The human-readable `result`
 * string is localised and must never be parsed back to detect failure — the
 * old `startsWith("Execution failed")` checks silently stopped matching the
 * moment the copy changed language or wording.
 */
export type ScheduledTaskRunOutcome = "completed" | "failed" | "skipped";

/**
 * Whether the previous *recorded* run of a task failed, from the structured
 * ScheduledTaskRun.status column (the same source reconcile uses). Returns
 * false when no run row exists — a task that only ever failed at dispatch
 * (no CommandRequest → no run row) cannot have "two consecutive" failures.
 */
async function wasPreviousRunFailed(taskId: string): Promise<boolean> {
	const previous = await prisma.scheduledTaskRun.findFirst({
		where: { scheduledTaskId: taskId, completedAt: { not: null } },
		orderBy: { dispatchedAt: "desc" },
		select: { status: true },
	});
	if (!previous) return false;
	return previous.status !== "COMPLETED";
}

export async function recordTaskRun(
	id: string,
	result: string,
	outcome: ScheduledTaskRunOutcome = "completed",
) {
	const task = await prisma.scheduledTask.findUnique({
		where: { id },
		select: { name: true, cronExpression: true, scheduleType: true, runCount: true, createdById: true, teamId: true },
	});
	if (!task) return;

	// Detect consecutive failures and notify the creator. Failure comes from
	// the structured `outcome` (current run) + ScheduledTaskRun.status
	// (previous run) — not from parsing the localised result string.
	if (outcome === "failed" && task.createdById) {
		const prevWasFailure = await wasPreviousRunFailed(id);
		if (prevWasFailure) {
			// At least 2 consecutive failures (current + previous) — fire alert
			notifyTaskConsecutiveFailed(task.createdById, task.name, 2, result.slice(0, 200), task.teamId).catch((err) => { taskLogger.warn("notifyTaskConsecutiveFailed failed", { error: err instanceof Error ? err.message : String(err) }); });
		}
	}

	return prisma.scheduledTask.update({
		where: { id },
		data: {
			lastRunAt: new Date(),
			lastResult: result,
			runCount: task.runCount + 1,
			claimedOccurrenceAt: null,
			nextRunAt: task.scheduleType === "ONCE" ? null : computeNextRun(task.cronExpression),
			...(task.scheduleType === "ONCE" ? { status: "DISABLED" as const } : {}),
		},
	});
}
