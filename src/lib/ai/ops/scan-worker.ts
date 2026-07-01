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
	pruneCompletedJobsByType,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { getSetting } from "@/lib/settings/service";

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

async function readModeFromSettings(): Promise<AiOpsMode> {
	const mode = await getSetting("ai.ops.mode").catch(() => "recommendation");
	return mode === "autonomous" ? "autonomous" : "recommendation";
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

	const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

	const [alertCount, recentFailures, playbookFailures, offlineServers, backupFailures, staleJobs] = await Promise.all([
		prisma.alertRule.count({ where: { enabled: true } }),
		prisma.commandRequest
			.count({
				where: {
					status: "FAILED",
					createdAt: { gte: since24h },
				},
			})
			.catch(() => 0),
		prisma.playbookRun
			.count({
				where: {
					status: "failed",
					createdAt: { gte: since24h },
				},
			})
			.catch(() => 0),
		// Servers that are enabled (potential connectivity issues require runtime checks)
		prisma.server
			.count({ where: { enabled: true } })
			.catch(() => 0),
		// Backup records that failed in the last 24h
		prisma.backupRecord
			.count({
				where: {
					status: "FAILED",
					createdAt: { gte: since24h },
				},
			})
			.catch(() => 0),
		// Stale completed jobs older than 7 days
		prisma.job
			.count({
				where: {
					status: "COMPLETED",
					updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
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
	if (offlineServers > 0) {
		signals.push({
			id: "server.offline",
			severity: "critical",
			title: "服务器离线",
			body: `${offlineServers} 台已启用服务器处于离线状态, 请检查网络或 SSH 连接。`,
			source: "server.status",
		});
	}
	if (backupFailures > 0) {
		signals.push({
			id: "backup.failure",
			severity: "warning",
			title: "备份失败",
			body: `近 24 小时有 ${backupFailures} 次备份失败, 建议检查存储空间或凭据。`,
			source: "backup.records",
		});
	}
	if (staleJobs > 100) {
		signals.push({
			id: "job.stale-accumulation",
			severity: "info",
			title: "陈旧任务堆积",
			body: `${staleJobs} 条已完成任务超过 7 天未清理, 建议执行缓存清理。`,
			source: "job.queue",
		});
	}

	// Check latest metric snapshots for resource pressure
	try {
		const recentMetrics = await prisma.metricSnapshot.findMany({
			where: { createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
			select: { serverId: true, cpuUsage: true, memUsage: true, diskUsage: true, isOnline: true },
			orderBy: { createdAt: "desc" },
			take: 500,
		});
		// Deduplicate by serverId — keep the most recent snapshot per server
		const seen = new Set<string>();
		let highCpuCount = 0;
		let highMemCount = 0;
		let highDiskCount = 0;
		for (const m of recentMetrics) {
			if (seen.has(m.serverId)) continue;
			seen.add(m.serverId);
			if (m.cpuUsage > 85) highCpuCount++;
			if (m.memUsage > 90) highMemCount++;
			if (m.diskUsage > 85) highDiskCount++;
		}
		if (highCpuCount > 0) {
			signals.push({
				id: "resource.high-cpu",
				severity: "warning",
				title: "CPU 使用率过高",
				body: `${highCpuCount} 台服务器 CPU 使用率超过 85%, 建议检查进程或扩容。`,
				source: "metric.cpu",
			});
		}
		if (highMemCount > 0) {
			signals.push({
				id: "resource.high-mem",
				severity: "warning",
				title: "内存使用率过高",
				body: `${highMemCount} 台服务器内存使用率超过 90%, 可能影响服务稳定性。`,
				source: "metric.memory",
			});
		}
		if (highDiskCount > 0) {
			signals.push({
				id: "resource.high-disk",
				severity: "critical",
				title: "磁盘空间不足",
				body: `${highDiskCount} 台服务器磁盘使用率超过 85%, 存在写满风险。`,
				source: "metric.disk",
			});
		}
	} catch {
		// metricSnapshot table may not have recent data; skip silently
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

	const actions: AiOpsRecommendedAction[] = signals.map((s) => {
		// Map signal source to an actionable recommendation.
		// Critical signals → alert.evaluate with high risk + requires approval
		// Info signals about stale jobs → cache.purge:stale (safe, no approval)
		// Warning signals → alert.evaluate with low risk (safe, no approval)
		const isStaleJobSignal = s.id === "job.stale-accumulation";
		const action = isStaleJobSignal ? "cache.purge:stale" : "alert.evaluate";
		const risk = s.severity === "critical" ? ("high" as const) : ("low" as const);
		return {
			id: `${s.id}.reco`,
			action,
			risk,
			requiresApproval: s.severity === "critical",
			reason: s.body,
		};
	});
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

			const mode = await readModeFromSettings();
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

			// Retention: prune old AI ops logs (keep latest 200)
			try {
				const oldLogs = await prisma.aiOpsLog.findMany({
					select: { id: true },
					orderBy: { createdAt: "desc" },
					take: 200,
				});
				if (oldLogs.length === 200) {
					const keepIds = oldLogs.map((l) => l.id);
					const result = await prisma.aiOpsLog.deleteMany({
						where: { id: { notIn: keepIds } },
					});
					if (result.count > 0) {
						logger.info("AI ops log retention pruned old logs", { pruned: result.count });
					}
				}
			} catch {
				// Retention is best-effort; don't fail the scan
			}

			// Also prune old completed scan jobs (keep latest 25)
			try {
				await pruneCompletedJobsByType({ type: AI_OPS_SCAN_JOB_TYPE, keepLatest: 25 });
			} catch {
				// best-effort
			}

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
