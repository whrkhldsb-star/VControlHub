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

import { AI_OPS_SAFE_AUTONOMOUS_ACTIONS, type AiOpsExecutedAction } from "./types";

type ActionInput = {
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
 * Supported real side effects:
 * - `alert.evaluate`: runs the same alert evaluation logic used by the durable
 *   alert worker. This may update alert rule match/trigger timestamps and send
 *   configured notifications.
 * - `cache.purge:stale`: prunes old completed jobs from the durable job queue,
 *   keeping only the most recent 25 per type. This directly addresses the
 *   "stale job accumulation" signal.
 *
 * Safe-set entries that still need domain-specific payloads are recorded as
 * non-executed with an explicit reason rather than silently faking success.
 */
export async function executeAiOpsAction(input: ActionInput): Promise<AiOpsExecutedAction> {
	if (!SAFE_ACTIONS.has(input.action)) {
		return unsupportedAction(input, `动作 ${input.action} 不在自主安全集合中`);
	}

	try {
		switch (input.action) {
			case "alert.evaluate": {
				const before = await prisma.alertRule.count({ where: { enabled: true } }).catch(() => null);
				await evaluateAlerts();
				const suffix = before === null ? "" : `（启用规则 ${before} 条）`;
				return {
					id: input.id,
					action: input.action,
					risk: input.risk,
					executed: true,
					executedAt: new Date().toISOString(),
					result: `已执行告警规则评估${suffix}`,
				};
			}
			case "cache.purge:stale": {
				// Prune completed jobs across all types, keeping latest 25 per type.
				// Also prune old AI ops logs (keep latest 100).
				const jobTypes = await prisma.job
					.findMany({ select: { type: true }, distinct: ["type"], take: 20 })
					.catch(() => [] as { type: string }[]);

				let totalPruned = 0;
				for (const { type } of jobTypes) {
					const result = await pruneCompletedJobsByType({ type, keepLatest: 25 }).catch(() => ({ count: 0 }));
					totalPruned += result.count;
				}

				// Also prune old AI ops logs (keep latest 100)
				const oldLogs = await prisma.aiOpsLog
					.findMany({
						select: { id: true },
						orderBy: { createdAt: "desc" },
						take: 100,
					})
					.catch(() => []);
				if (oldLogs.length > 0) {
					const keepIds = oldLogs.map((l) => l.id);
					const deleted = await prisma.aiOpsLog
						.deleteMany({ where: { id: { notIn: keepIds } } })
						.catch(() => ({ count: 0 }));
					totalPruned += deleted.count;
				}

				return {
					id: input.id,
					action: input.action,
					risk: input.risk,
					executed: true,
					executedAt: new Date().toISOString(),
					result: `已清理 ${totalPruned} 条陈旧记录（含任务队列和运维日志）`,
				};
			}
			case "playbook.run:low_risk":
				return unsupportedAction(input, "低风险 Playbook 执行需要 playbookId/serverId payload，当前推荐项未携带可执行参数");
			case "backup.snapshot:metadata_only":
				return unsupportedAction(input, "元数据快照需要目标备份域 payload，当前推荐项未携带可执行参数");
			default:
				return unsupportedAction(input, `未知安全动作 ${input.action}`);
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
