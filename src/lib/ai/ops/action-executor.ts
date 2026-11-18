/**
 * TR-032 E03: concrete executor for AI ops safe actions.
 *
 * The AI ops service keeps the autonomous allow-list gate, then delegates the
 * side effect here. Keeping the executor small and explicit prevents a
 * recommendation string from becoming arbitrary code execution.
 */
import { prisma } from "@/lib/db";
import { evaluateAlerts } from "@/lib/health/service-alerts";
import { pruneCompletedJobsByType } from "@/lib/job/service";

import { pruneAiOpsLogs } from "./retention";
import { AI_OPS_SAFE_AUTONOMOUS_ACTIONS, type AiOpsExecutedAction } from "./types";

type ActionInput = {
	logId?: string;
	id: string;
	action: string;
	risk: "low" | "medium" | "high";
};

const SAFE_ACTIONS = new Set<string>(AI_OPS_SAFE_AUTONOMOUS_ACTIONS);

function unsupportedAction(input: ActionInput, reason: string): AiOpsExecutedAction {
	return {
		id: input.id,
		action: input.action,
		risk: input.risk,
		executed: false,
		executedAt: new Date().toISOString(),
		errorMessage: reason,
	};
}

/**
 * Execute one whitelisted AI ops action and return an auditable result row.
 *
 * Supported real side effects (FEAT-P1-3 expanded):
 * - `alert.evaluate`: runs alert evaluation, may trigger notifications.
 * - `cache.purge:stale`: prunes old completed jobs and AI ops logs.
 *
 * All executions produce an auditable result row with structured output.
 */
export async function executeAiOpsAction(input: ActionInput): Promise<AiOpsExecutedAction> {
	if (!SAFE_ACTIONS.has(input.action)) {
		return unsupportedAction(input, `Action ${input.action} is not in the autonomous safe set`);
	}

	try {
		switch (input.action) {
			case "alert.evaluate": {
				const before = await prisma.alertRule.count({ where: { enabled: true } }).catch(() => null);
				await evaluateAlerts();
				const suffix = before === null ? "" : ` (enabled rules: ${before})`;
				return {
					id: input.id,
					action: input.action,
					risk: input.risk,
					executed: true,
					executedAt: new Date().toISOString(),
					result: `Alert rule evaluation executed${suffix}`,
				};
			}
			case "cache.purge:stale": {
				// Prune completed jobs across all types, keeping latest 25 per type.
				// Prune AI ops logs with AI_OPS_LOG_RETENTION_KEEP (same as scan-worker).
				// No take cap: every distinct job.type must be prune-eligible.
				const jobTypes = await prisma.job.findMany({ select: { type: true }, distinct: ["type"] });
				let totalPruned = 0;
				let failedSteps = 0;
				for (const { type } of jobTypes) {
					try {
						const result = await pruneCompletedJobsByType({ type, keepLatest: 25 });
						totalPruned += result.count;
					} catch {
						failedSteps++;
					}
				}

				try {
					const deleted = await pruneAiOpsLogs(input.logId);
					totalPruned += deleted.count;
				} catch {
					failedSteps++;
				}
				if (failedSteps) {
					return unsupportedAction(input, `Pruned ${totalPruned} stale records. ${failedSteps} cleanup steps failed.`);
				}

				return {
					id: input.id,
					action: input.action,
					risk: input.risk,
					executed: true,
					executedAt: new Date().toISOString(),
					result: `Pruned ${totalPruned} stale records (including job queue and ops logs)`,
				};
			}
			default:
				return unsupportedAction(input, `Unknown safe action ${input.action}`);
		}
	} catch (error) {
		return {
			id: input.id,
			action: input.action,
			risk: input.risk,
			executed: false,
			executedAt: new Date().toISOString(),
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
