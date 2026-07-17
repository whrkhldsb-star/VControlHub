import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { notifyTaskConsecutiveFailed } from "@/lib/notification/service";
import { createLogger } from "@/lib/logging";
import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";

const taskLogger = createLogger("scheduled-task");

/* ── Types ────────────────────────────────────────────────── */

export type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

export type CreateScheduledTaskInput = {
	name: string;
	cronExpression: string;
	command: string;
	reason?: string;
	serverIds: string[];
	createdById?: string;
	/** Optional explicit team; defaults to session.currentTeamId when session is provided. */
	teamId?: string | null;
};

export type UpdateScheduledTaskInput = Partial<CreateScheduledTaskInput> & {
	status?: "ACTIVE" | "PAUSED" | "DISABLED";
};

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

export function computeNextRun(cronExpression: string): Date {
	try {
		const interval = CronExpressionParser.parse(cronExpression, { currentDate: new Date() });
		return interval.next().toDate();
	} catch {
		// 无效的 cron 表达式，默认1分钟后重试
		return new Date(Date.now() + 60_000);
	}
}

/* ── Helpers ──────────────────────────────────────────────── */

function normalizeServerIds(serverIds: string[]) {
	return Array.from(new Set(serverIds.map((id) => id.trim()).filter(Boolean)));
}

/**
 * Prevent scheduling commands against servers outside the caller's team.
 * Mirrors alert-rule / command create target checks (legacy teamId=null still allowed via teamWhere).
 */
async function assertScheduledTaskServersInScope(
	serverIds: string[],
	session?: SessionScope | null,
): Promise<void> {
	const ids = normalizeServerIds(serverIds);
	if (ids.length === 0 || !session) return;
	const scope = teamWhere(session);
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
	const nextRun = computeNextRun(input.cronExpression);
	const teamFromSession = session ? teamCreateData(session).teamId : undefined;
	const teamId =
		input.teamId !== undefined ? input.teamId : (teamFromSession ?? null);
	const serverIds = normalizeServerIds(input.serverIds);
	await assertScheduledTaskServersInScope(serverIds, session);
	return prisma.scheduledTask.create({
		data: {
			name: input.name,
			cronExpression: input.cronExpression,
			command: input.command,
			reason: input.reason ?? null,
			serverIds,
			createdById: input.createdById ?? session?.userId ?? null,
			nextRunAt: nextRun,
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
	if (!task) throw new NotFoundError("Scheduled task not found");
	return task;
}

export async function updateScheduledTask(
	id: string,
	input: UpdateScheduledTaskInput,
	session?: SessionScope | null,
) {
	const existing = await getScheduledTaskForSession(id, session);
	if (!existing) throw new NotFoundError("Scheduled task not found");

	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.cronExpression !== undefined) {
		data.cronExpression = input.cronExpression;
		data.nextRunAt = computeNextRun(input.cronExpression);
	}
	if (input.command !== undefined) data.command = input.command;
	if (input.reason !== undefined) data.reason = input.reason;
	if (input.serverIds !== undefined) {
		const serverIds = normalizeServerIds(input.serverIds);
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
	if (!existing) throw new NotFoundError("Scheduled task not found");
	return prisma.scheduledTask.delete({ where: { id } });
}

export async function toggleScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const current = await getScheduledTaskForSession(id, session);
	if (!current) throw new NotFoundError("Scheduled task not found");
	const newStatus = current.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
	return prisma.scheduledTask.update({
		where: { id },
		data: {
			status: newStatus,
			...(newStatus === "ACTIVE"
				? { nextRunAt: computeNextRun(current.cronExpression) }
				: { nextRunAt: null }),
		},
	});
}

export async function retryScheduledTask(
	id: string,
	session?: SessionScope | null,
) {
	const task = await getScheduledTaskForSession(id, session);
	if (!task) throw new NotFoundError("Scheduled task not found");
	if (task.serverIds.length === 0 || !task.createdById) {
		await recordTaskRun(task.id, "Manual retry failed: no target server or no creator");
		throw new BusinessError("Scheduled task missing target server or creator, cannot retry");
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
	});

	await recordTaskRun(task.id, `Manual retry has triggered command request ${result.id}`);
	return prisma.scheduledTask.findUniqueOrThrow({ where: { id } });
}

export async function recordTaskRun(id: string, result: string) {
	const task = await prisma.scheduledTask.findUnique({
		where: { id },
		select: { name: true, cronExpression: true, runCount: true, createdById: true, lastResult: true, teamId: true },
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
			nextRunAt: computeNextRun(task.cronExpression),
		},
	});
}
