import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { notifyTaskConsecutiveFailed } from "@/lib/notification/service";
import { createLogger } from "@/lib/logging";
import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { t } from "@/lib/i18n/service-translations";
import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";

const taskLogger = createLogger("scheduled-task");

/* ── Types ────────────────────────────────────────────────── */

export type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

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
	return {
		scheduleType,
		cronExpression: input.cronExpression.trim(),
		runAt: null,
		nextRunAt: computeNextRun(input.cronExpression),
	} as const;
}

/* ── Basic cron description ───────────────────────────────── */

export function describeCron(expr: string): string {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return "Custom time expression";
	const [min, hour, day, month, dow] = parts;
	if (min === "*" && hour === "*") return "Every minute";
	if (min!.startsWith("*/") && hour === "*") return `Every ${min!.slice(2)} minutes`;
	if (hour === "*" && min !== "*") return `Minute ${min!} of every hour`;
	if (min !== "*" && hour !== "*" && day === "*" && month === "*" && dow === "*") return `Daily at ${hour!}:${min!.padStart(2, "0")}`;
	if (dow !== "*" && min !== "*" && hour !== "*") {
		const dayNames: Record<string, string> = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" };
		return `Every ${dayNames[dow!] ?? "day " + dow!} ${hour!}:${min!.padStart(2, "0")}`;
	}
	return expr;
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
	const scope = serverTeamWhere(session);
	// team:manage → empty scope, still verify servers exist
	const servers = await prisma.server.findMany({
		where: { id: { in: ids }, ...scope },
		select: { id: true },
	});
	if (servers.length !== ids.length) {
		throw new ValidationError(
			"One or more target servers were not found or are outside your team scope",
		);
	}
}

function teamScopeWhere(session?: SessionScope | null): Record<string, unknown> {
	return session ? teamWhere(session) : {};
}

/**
 * Load a scheduled task by id under optional team scope.
 * Used by mutate paths so cross-team IDs resolve as not-found (no IDOR).
 */
async function getScheduledTaskForSession(id: string, session?: SessionScope | null) {
	return prisma.scheduledTask.findFirst({
		where: { id, ...teamScopeWhere(session) },
	});
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createScheduledTask(
	input: CreateScheduledTaskInput,
	session?: SessionScope | null,
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
	session?: SessionScope | null,
) {
	return prisma.scheduledTask.findMany({
		where: teamScopeWhere(session),
		orderBy: { createdAt: "desc" },
		take: limit,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function getScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const task = await getScheduledTaskForSession(id, session);
	if (!task) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	return task;
}

export async function updateScheduledTask(
	id: string,
	input: UpdateScheduledTaskInput,
	session?: SessionScope | null,
) {
	const existing = await getScheduledTaskForSession(id, session);
	if (!existing) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));

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
	if (input.status !== undefined) data.status = input.status;
	if (input.teamId !== undefined) data.teamId = input.teamId;
	return prisma.scheduledTask.update({ where: { id }, data });
}

export async function deleteScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const existing = await getScheduledTaskForSession(id, session);
	if (!existing) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	return prisma.scheduledTask.delete({ where: { id } });
}

export async function toggleScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const current = await getScheduledTaskForSession(id, session);
	if (!current) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	const newStatus = current.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
	if (newStatus === "ACTIVE" && current.scheduleType === "ONCE" && (!current.runAt || current.runAt.getTime() <= Date.now())) {
		throw new BusinessError(t("backend.scheduled-task.completedCannotResume"));
	}
	return prisma.scheduledTask.update({
		where: { id },
		data: {
			status: newStatus,
			...(newStatus === "ACTIVE"
				? { nextRunAt: current.scheduleType === "ONCE" ? current.runAt : computeNextRun(current.cronExpression) }
				: { nextRunAt: null }),
		},
	});
}

export async function retryScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const task = await getScheduledTaskForSession(id, session);
	if (!task) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
	if (task.serverIds.length === 0 || !task.createdById) {
		await recordTaskRun(task.id, "Manual retry failed: no target server or no creator");
		throw new BusinessError(t("backend.scheduled-task.scheduledTaskMissingTargetServerOrCreatorCannot"));
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

export async function recordTaskDispatch(id: string, commandRequestId: string, manual = false) {
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
					...(!manual ? {
						nextRunAt: task.scheduleType === "ONCE" ? null : computeNextRun(task.cronExpression),
						...(task.scheduleType === "ONCE" ? { status: "DISABLED" as const } : {}),
					} : {}),
				},
			});
		}
		return existing ?? { scheduledTaskId: id, commandRequestId, status: "DISPATCHED", manual };
	});
}

const TERMINAL_COMMAND_STATUSES = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"]);

export async function reconcileScheduledTaskRuns(limit = 500) {
	const pendingRuns = await prisma.scheduledTaskRun.findMany({
		where: { status: "DISPATCHED" },
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
		const claimed = await prisma.scheduledTaskRun.updateMany({
			where: { id: run.id, status: "DISPATCHED" },
			data: { status, result, completedAt },
		});
		if (claimed.count === 0) continue;
		await prisma.scheduledTask.updateMany({
			where: {
				id: run.scheduledTaskId,
				OR: [{ lastRunAt: null }, { lastRunAt: { lte: run.dispatchedAt } }],
			},
			data: { lastResult: result },
		});
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

export async function recordTaskRun(id: string, result: string) {
	const task = await prisma.scheduledTask.findUnique({
		where: { id },
		select: { name: true, cronExpression: true, scheduleType: true, runCount: true, createdById: true, lastResult: true, teamId: true },
	});
	if (!task) return;

	// Detect consecutive failures and notify the creator
	const isFailure = result.startsWith("Execution failed") || result.startsWith("Manual retry failed");
	if (isFailure && task.createdById) {
		const prevWasFailure = task.lastResult?.startsWith("Execution failed") || task.lastResult?.startsWith("Manual retry failed");
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
			nextRunAt: task.scheduleType === "ONCE" ? null : computeNextRun(task.cronExpression),
			...(task.scheduleType === "ONCE" ? { status: "DISABLED" as const } : {}),
		},
	});
}
