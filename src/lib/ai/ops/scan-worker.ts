/**
 * TR-032 E02: Smart AI ops — daily scan worker.
 *
 * Schedules a `ai.ops.scan` durable job every 24h. The actual scan logic
 * (calling the AI provider, collecting findings) is intentionally
 * minimal for v1: it surfaces known system-health signals (CPU, memory,
 * disk, alert-rule noise) and writes a `AiOpsLog` row so the UI has
 * something to show. A future tick can swap the body of `buildScan` for
 * a real AI provider call without changing the durable-job contract.
 *
 * Pattern: same shape as `src/lib/cost/snapshot-worker.ts` and
 * `src/lib/operation-task/retention-worker.ts`.
 *   - durable job type `ai.ops.scan`
 *   - claimNextJob / heartbeatJob / completeJob / failJob
 *   - setInterval 24h + fire-once-on-startup
 *   - globalThis state mirror for re-entrancy
 */
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import {
	claimNextJob,
	completeJob,
	enqueueJob,
	failJob,
	heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import {
	AI_OPS_DEFAULT_SCHEDULE_HOUR,
	AI_OPS_SCAN_JOB_TYPE,
	type AiOpsExecutedAction,
	type AiOpsFinding,
	type AiOpsFindingSeverity,
	type AiOpsMode,
	type AiOpsRecommendedAction,
} from "./types";
import { createAiOpsLog, completeScan } from "./service";
import { executeAiOpsAction } from "./action-executor";

const logger = createLogger("ai-ops-scan-worker");

export const AI_OPS_SCAN_LEASE_MS = computeLeaseMs("ai-ops-scan");
const AI_OPS_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const AI_OPS_SCAN_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:ai-ops-scan:${process.pid}`;

type AiOpsScanWorkerState = {
	started: boolean;
	running: boolean;
	timer: NodeJS.Timeout | null;
};

type AiOpsScanWorkerGlobal = typeof globalThis & {
	__vcontrolhubAiOpsScanWorker?: AiOpsScanWorkerState;
};

function getWorkerState(): AiOpsScanWorkerState {
	const g = globalThis as AiOpsScanWorkerGlobal;
	g.__vcontrolhubAiOpsScanWorker ??= {
		started: false,
		running: false,
		timer: null,
	};
	return g.__vcontrolhubAiOpsScanWorker;
}

async function hasActiveScanJob(): Promise<boolean> {
	const row = await prisma.job.findFirst({
		where: {
			type: AI_OPS_SCAN_JOB_TYPE,
			status: { in: ["PENDING", "RUNNING"] },
		},
		select: { id: true },
	});
	return row !== null;
}

async function enqueueScanJob(reason: string) {
	if (await hasActiveScanJob()) return null;
	return enqueueJob({
		type: AI_OPS_SCAN_JOB_TYPE,
		title: "AI 运维每日扫描",
		payload: { reason, requestedAt: new Date().toISOString() },
		priority: -2, // Below user-triggered scans but above nightly snapshots
		maxAttempts: 2,
	});
}

function readModeFromSettings(): AiOpsMode {
	// The default mode is hard-coded for the worker; the UI can override
	// by enqueuing a manual scan with a different mode.
	void AI_OPS_DEFAULT_SCHEDULE_HOUR;
	return "recommendation";
}

interface SystemHealthSignal {
	id: string;
	severity: AiOpsFindingSeverity;
	title: string;
	body: string;
	source: string;
}

/**
 * Surface known system-health signals as findings. Real AI provider
 * integration is a v2; this keeps the worker honest and gives the UI
 * something to display.
 */
async function collectSystemHealthSignals(): Promise<SystemHealthSignal[]> {
	const signals: SystemHealthSignal[] = [];

	const [alertCount, recentFailures, playbookFailures] = await Promise.all([
		prisma.alertRule.count({ where: { enabled: true } }),
		prisma.commandRequest
			.count({
				where: {
					status: "FAILED",
					createdAt: {
						gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
					},
				},
			})
			.catch(() => 0),
		prisma.playbookRun
			.count({
				where: {
					status: "failed",
					createdAt: {
						gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
					},
				},
			})
			.catch(() => 0),
	]);

	if (alertCount > 20) {
		signals.push({
			id: "alert.noise",
			severity: "warning",
			title: "告警规则偏多",
			body: `当前已启用 ${alertCount} 条告警规则, 建议审视是否仍有冗余。`,
			source: "alert.rules",
		});
	}
	if (recentFailures > 5) {
		signals.push({
			id: "command.failure-burst",
			severity: "critical",
			title: "命令执行失败聚集",
			body: `近 24 小时有 ${recentFailures} 次非 0 退出, 可能存在脚本/凭据问题。`,
			source: "command.execution",
		});
	}
	if (playbookFailures > 0) {
		signals.push({
			id: "playbook.failure",
			severity: "warning",
			title: "Playbook 失败",
			body: `近 24 小时 ${playbookFailures} 次 Playbook 失败, 建议检查。`,
			source: "playbook.run",
		});
	}
	return signals;
}

function buildScan(
	mode: AiOpsMode,
	signals: SystemHealthSignal[],
): {
	findings: AiOpsFinding[];
	actions: AiOpsRecommendedAction[] | AiOpsExecutedAction[];
	status: "ok" | "warning";
} {
	const findings: AiOpsFinding[] = signals.map((s) => ({
		id: s.id,
		severity: s.severity,
		title: s.title,
		body: s.body,
		source: s.source,
	}));

	if (mode === "autonomous") {
		const actions: AiOpsExecutedAction[] = signals
			.filter((s) => s.severity === "warning")
			.map((s) => ({
				id: `${s.id}.autonomous`,
				action: "alert.evaluate",
				risk: "low" as const,
				executed: false,
				result: "等待自主执行器处理",
			}));
		return {
			findings,
			actions,
			status: signals.length > 0 ? "warning" : "ok",
		};
	}

	const actions: AiOpsRecommendedAction[] = signals.map((s) => ({
		id: `${s.id}.reco`,
		action: s.severity === "critical" ? "command.execute:diagnose" : "alert.evaluate",
		risk: s.severity === "critical" ? ("high" as const) : ("low" as const),
		requiresApproval: s.severity === "critical",
		reason: s.body,
	}));
	return {
		findings,
		actions,
		status: signals.length > 0 ? "warning" : "ok",
	};
}

export async function runAiOpsScanWorkerOnce(reason = "manual"): Promise<boolean> {
	const state = getWorkerState();
	if (state.running) {
		logger.warn("Skipping AI ops scan tick because a previous tick is still running", {
			reason,
		});
		return false;
	}
	state.running = true;
	try {
		await enqueueScanJob(reason);
		const job = await claimNextJob({
			workerId: AI_OPS_SCAN_WORKER_ID,
			types: [AI_OPS_SCAN_JOB_TYPE],
			leaseMs: AI_OPS_SCAN_LEASE_MS,
		});
		if (!job) return false;

		try {
			await heartbeatJob(job.id, AI_OPS_SCAN_WORKER_ID, {
				leaseMs: AI_OPS_SCAN_LEASE_MS,
				progress: "正在收集系统健康信号",
			});

			const mode = readModeFromSettings();
			const log = await createAiOpsLog({
				triggerType: reason === "interval" || reason === "startup" ? "scheduled" : "manual",
				mode,
				triggeredById: null,
				notes: `scan reason=${reason}`,
			});

			const signals = await collectSystemHealthSignals();
			const { findings, actions: plannedActions, status } = buildScan(mode, signals);
			const actions = mode === "autonomous"
				? await Promise.all(
					(plannedActions as AiOpsExecutedAction[]).map((action) =>
						executeAiOpsAction({
							id: action.id,
							action: action.action,
							risk: action.risk,
						}),
					)
				)
				: plannedActions;

			const completed = await completeScan({
				logId: log.id,
				status,
				findings,
				actions,
				notes: `ai.ops.scan reason=${reason}`,
			});

			await completeJob(job.id, AI_OPS_SCAN_WORKER_ID, {
				logId: completed.id,
				mode: completed.mode,
				findingCount: findings.length,
				actionCount: actions.length,
				status: completed.status,
				reason,
			});
			logger.info("AI ops daily scan complete", {
				jobId: job.id,
				logId: completed.id,
				mode: completed.mode,
				findingCount: findings.length,
				actionCount: actions.length,
			});
			return true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "AI 运维扫描失败";
			await failJob(job.id, AI_OPS_SCAN_WORKER_ID, message.slice(0, 2000), {
				retryAfterMs: 60 * 60 * 1000, // 1h retry
			});
			logger.error("AI ops scan failed", {
				reason,
				jobId: job.id,
				error: message,
			});
			return true;
		}
	} finally {
		state.running = false;
	}
}

export async function startAiOpsScanWorker() {
	const state = getWorkerState();
	if (state.started) return state;
	state.started = true;

	void runAiOpsScanWorkerOnce("startup").catch((error) => {
		logger.error("AI ops scan worker tick failed", {
			reason: "startup",
			error: error instanceof Error ? error.message : String(error),
		});
	});
	state.timer = setInterval(() => {
		void runAiOpsScanWorkerOnce("interval").catch((error) => {
			logger.error("AI ops scan worker tick failed", {
				reason: "interval",
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}, AI_OPS_SCAN_INTERVAL_MS);
	state.timer.unref?.();

	logger.info("AI ops scan durable job worker started", {
		workerId: AI_OPS_SCAN_WORKER_ID,
		intervalMs: AI_OPS_SCAN_INTERVAL_MS,
	});
	return state;
}

export function stopAiOpsScanWorkerForTests() {
	const state = getWorkerState();
	if (state.timer) clearInterval(state.timer);
	state.started = false;
	state.running = false;
	state.timer = null;
}
