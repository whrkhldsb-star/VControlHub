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
	if (parts.length !== 5) return "自定义时间表达式";
	const [min, hour, day, month, dow] = parts;
	if (min === "*" && hour === "*") return "每分钟";
	if (min!.startsWith("*/") && hour === "*") return `每 ${min!.slice(2)} 分钟`;
	if (hour === "*" && min !== "*") return `每小时第 ${min!} 分钟`;
	if (min !== "*" && hour !== "*" && day === "*" && month === "*" && dow === "*") return `每天 ${hour!}:${min!.padStart(2, "0")}`;
	if (dow !== "*" && min !== "*" && hour !== "*") {
		const dayNames: Record<string, string> = { "0": "周日", "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六" };
		return `每${dayNames[dow!] ?? "周" + dow!} ${hour!}:${min!.padStart(2, "0")}`;
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
	if (!current) throw new NotFoundError("定时任务不存在");
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
	if (!task) throw new NotFoundError("定时任务不存在");
	if (task.serverIds.length === 0 || !task.createdById) {
		await recordTaskRun(task.id, "手动重试失败：无目标服务器或无创建者");
		throw new BusinessError("定时任务缺少目标服务器或创建者，无法重试");
	}

	const result = await createCommandRequest({
		title: `定时任务重试：${task.name}`,
		command: task.command,
		reason: task.reason ?? `手动重试定时任务 ${task.name}`,
		submissionMode: "user",
		requesterId: task.createdById,
		serverIds: task.serverIds,
	});

	await recordTaskRun(task.id, `手动重试已触发命令请求 ${result.id}`);
	return prisma.scheduledTask.findUniqueOrThrow({ where: { id } });
}

export async function recordTaskRun(id: string, result: string) {
	const task = await prisma.scheduledTask.findUnique({ where: { id }, select: { name: true, cronExpression: true, runCount: true, createdById: true, lastResult: true } });
	if (!task) return;

	// Detect consecutive failures and notify the creator
	const isFailure = result.startsWith("执行失败") || result.startsWith("手动重试失败");
	if (isFailure && task.createdById) {
		const prevWasFailure = task.lastResult?.startsWith("执行失败") || task.lastResult?.startsWith("手动重试失败");
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
