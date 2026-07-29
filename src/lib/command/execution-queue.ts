import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";

export const COMMAND_EXECUTION_JOB_TYPE = "command.execution";

export type CommandExecutionJobPayload = {
	commandRequestId: string;
	summary?: string;
	requestedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseCommandExecutionJobPayload(
	payload: Prisma.JsonValue,
): CommandExecutionJobPayload {
	if (!isRecord(payload)) throw new Error("Command execution task payload invalid");
	const commandRequestId =
		typeof payload.commandRequestId === "string" && payload.commandRequestId.trim()
			? payload.commandRequestId.trim()
			: null;
	if (!commandRequestId) throw new Error("Command execution task missing commandRequestId");
	return {
		commandRequestId,
		summary: typeof payload.summary === "string" ? payload.summary : undefined,
		requestedAt: typeof payload.requestedAt === "string" ? payload.requestedAt : undefined,
	};
}

export async function enqueueCommandExecutionJob(input: {
	commandRequestId: string;
	summary?: string;
}) {
	const commandRequestId = input.commandRequestId?.trim();
	if (!commandRequestId) throw new Error("Command execution task missing commandRequestId");
	const request = await prisma.commandRequest.findUnique({
		where: { id: commandRequestId },
		select: { teamId: true, createdBy: true },
	});
	return enqueueJob({
		type: COMMAND_EXECUTION_JOB_TYPE,
		title: `Execute command ${commandRequestId}`,
		payload: {
			commandRequestId,
			summary: input.summary,
			requestedAt: new Date().toISOString(),
		},
		priority: 0,
		maxAttempts: 1,
		teamId: request?.teamId ?? null,
		createdBy: request?.createdBy ?? null,
	});
}
