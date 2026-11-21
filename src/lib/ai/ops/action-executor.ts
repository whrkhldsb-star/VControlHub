import type { Prisma } from "@prisma/client";
import { apiCopy, currentCopyLocale } from "@/lib/i18n/api-copy";
import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/db/json";
import { enqueueJob } from "@/lib/job/service";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { pruneReviewedJobs } from "./retention";
import { aiOpsExecutedActionSchema } from "./schema";
import { AI_OPS_SAFE_AUTONOMOUS_ACTIONS, type AiOpsExecutedAction } from "./types";

type ActionInput = Pick<AiOpsExecutedAction, "id" | "action" | "risk" | "cleanup">;
const safeSet = new Set<string>(AI_OPS_SAFE_AUTONOMOUS_ACTIONS);

/** Both effects are database writes. The caller commits them with their receipt. */
export async function executeAiOpsAction(
	input: ActionInput, tx: Prisma.TransactionClient, checkLease: () => Promise<void>,
): Promise<AiOpsExecutedAction> {
	const outcome = { id: input.id, action: input.action, risk: input.risk, ...(input.cleanup && { cleanup: input.cleanup }), executedAt: new Date().toISOString() };
	if (!safeSet.has(input.action)) return { ...outcome, executed: false, errorMessage: apiCopy("apiCopy.action.is.not.in.the.autonomous.safe.set.manual.execution.requir.54b8adc7", { v0: input.action }) };
	if (input.action === "alert.evaluate") {
		await checkLease();
		const job = await enqueueJob({
			type: "alert.evaluate", title: "Alert rule evaluation", payload: { reason: "ai.ops", actionId: input.id },
			maxAttempts: 1, priority: -10,
		}, tx);
		return { ...outcome, executed: true, result: `Alert rule evaluation queued (job ${job.id})` };
	}
	if (!input.cleanup) {
		const errorMessage = currentCopyLocale() === "zh"
			? "此旧建议未保存清理范围，请重新扫描。"
			: "This older recommendation has no saved cleanup scope. Run a new scan.";
		return { ...outcome, executed: false, errorMessage };
	}
	await checkLease();
	const removed = await pruneReviewedJobs(tx, input.cleanup);
	return { ...outcome, executed: true, result: `Pruned ${removed} stale completed jobs` };
}

export function scanActionReceipts(value: unknown): AiOpsExecutedAction[] {
	return value === undefined ? [] : aiOpsExecutedActionSchema.array().parse(value);
}

export function executeScanAction(jobId: string, workerId: string, attempts: number, action: ActionInput, signal: AbortSignal) {
	// Receipts live as long as the job, including while its event history is pruned.
	return prisma.$transaction(async (tx) => {
		const checkLease = async () => {
			signal.throwIfAborted();
			const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM jobs WHERE id = ${jobId}
				AND "workerId" = ${workerId} AND attempts = ${attempts} AND status = 'RUNNING'
				AND "leaseExpiresAt" > clock_timestamp() FOR UPDATE`;
			signal.throwIfAborted();
			if (!rows.length) throw new LeaseLostError(jobId);
		};
		await checkLease();
		const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { payload: true } });
		const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
		const prior = scanActionReceipts(payload.actionReceipts);
		const saved = prior.find((entry) => entry.id === action.id);
		if (saved) return saved;
		const result = await executeAiOpsAction(action, tx, checkLease);
		const actionReceipts: AiOpsExecutedAction[] = [...prior, result];
		await tx.job.update({ where: { id: jobId }, data: { payload: { ...payload, actionReceipts: toJsonValue(actionReceipts) } } });
		return result;
	});
}
