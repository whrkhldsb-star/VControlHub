import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { notifyTaskConsecutiveFailed } from "@/lib/notification/service";

/* ── Types ────────────────────────────────────────────────── */

export type CreateScheduledTaskInput = {
	name: string;
	cronExpression: string;
	command: string;
	reason?: string;
	serverIds: string[];
	createdById?: string;
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

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createScheduledTask(input: CreateScheduledTaskInput) {
	const nextRun = computeNextRun(input.cronExpression);
	return prisma.scheduledTask.create({
		data: {
			name: input.name,
			cronExpression: input.cronExpression,
			command: input.command,
			reason: input.reason ?? null,
			serverIds: normalizeServerIds(input.serverIds),
			createdById: input.createdById ?? null,
			nextRunAt: nextRun,
		},
	});
}

export async function listScheduledTasks(limit = 200) {
	return prisma.scheduledTask.findMany({
		orderBy: { createdAt: "desc" },
		take: limit,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function updateScheduledTask(id: string, input: UpdateScheduledTaskInput) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.cronExpression !== undefined) {
		data.cronExpression = input.cronExpression;
		data.nextRunAt = computeNextRun(input.cronExpression);
	}
	if (input.command !== undefined) data.command = input.command;
	if (input.reason !== undefined) data.reason = input.reason;
	if (input.serverIds !== undefined) data.serverIds = normalizeServerIds(input.serverIds);
	if (input.status !== undefined) data.status = input.status;
	return prisma.scheduledTask.update({ where: { id }, data });
}

export async function deleteScheduledTask(id: string) {
	return prisma.scheduledTask.delete({ where: { id } });
}

export async function toggleScheduledTask(id: string) {
	const current = await prisma.scheduledTask.findUnique({ where: { id }, select: { status: true } });
	if (!current) throw new NotFoundError("Scheduled task not found");
	const newStatus = current.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
	const nextRun = newStatus === "ACTIVE" ? undefined : null;
	return prisma.scheduledTask.update({
		where: { id },
		data: {
			status: newStatus,
			...(nextRun === null ? { nextRunAt: null } : { nextRunAt: computeNextRun((await prisma.scheduledTask.findUnique({ where: { id }, select: { cronExpression: true } }))!.cronExpression) }),
		},
	});
}

export async function retryScheduledTask(id: string) {
	const task = await prisma.scheduledTask.findUnique({ where: { id } });
	if (!task) throw new NotFoundError("Scheduled task not found");
	if (task.serverIds.length === 0 || !task.createdById) {
		await recordTaskRun(task.id, "Manual retry failed: no target server or no creator");
		throw new BusinessError("Scheduled task missing target server or creator, cannot retry");
	}

	const result = await createCommandRequest({
		title: `Scheduled task retry: ${task.name}`,
		command: task.command,
		reason: task.reason ?? `Manually retry scheduled task ${task.name}`,
		submissionMode: "user",
		requesterId: task.createdById,
		serverIds: task.serverIds,
	});

	await recordTaskRun(task.id, `Manual retry has triggered command request ${result.id}`);
	return prisma.scheduledTask.findUniqueOrThrow({ where: { id } });
}

export async function recordTaskRun(id: string, result: string) {
	const task = await prisma.scheduledTask.findUnique({ where: { id }, select: { name: true, cronExpression: true, runCount: true, createdById: true, lastResult: true } });
	if (!task) return;

	// Detect consecutive failures and notify the creator
	const isFailure = result.startsWith("Execution failed") || result.startsWith("Manual retry failed");
	if (isFailure && task.createdById) {
		const prevWasFailure = task.lastResult?.startsWith("Execution failed") || task.lastResult?.startsWith("Manual retry failed");
		if (prevWasFailure) {
			// At least 2 consecutive failures (current + previous) — fire alert
			notifyTaskConsecutiveFailed(task.createdById, task.name, 2, result.slice(0, 200)).catch(() => {});
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
