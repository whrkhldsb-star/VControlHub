/**
 * TR-032 E02: Smart AI ops — service layer.
 *
 * Source of truth is `ai_ops_logs`. The service is intentionally
 * self-contained: it does not call any AI provider directly. Instead the
 * scan worker is responsible for invoking the AI provider, producing
 * findings, and persisting them via `completeScan`. The service just
 * exposes the CRUD + filter operations the UI / API need.
 *
 * Mode enforcement: the `executeRecommendation` helper accepts a
 * "forceAutonomous" flag, but it never bypasses the autonomous safe-set
 * gate. Any action not in `AI_OPS_SAFE_AUTONOMOUS_ACTIONS` is recorded
 * as `executed: false` with an explanatory errorMessage — the caller
 * is expected to handle that (UI shows it as "needs manual approval").
 *
 * Functions exposed:
 *   - listAiOpsLogs   (filter by mode / status / triggerType + limit)
 *   - getAiOpsLog
 *   - createAiOpsLog  (creates a "running" row at the start of a scan)
 *   - completeScan    (writes findings + actions + status at scan end)
 *   - executeRecommendation
 *   - listFindings    (read-only, by log id)
 *   - summariseAiOps (counts for the dashboard)
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import {
	aiOpsRecommendedActionSchema,
	aiOpsExecutedActionSchema,
	aiOpsFindingSchema,
} from "./schema";
import type {
	AiOpsExecutedAction,
	AiOpsFinding,
	AiOpsLogRecord,
	AiOpsMode,
	AiOpsRecommendedAction,
	AiOpsStatus,
	AiOpsTriggerType,
} from "./types";
import { AI_OPS_SAFE_AUTONOMOUS_ACTIONS } from "./types";
import { executeAiOpsAction } from "./action-executor";
import { t } from "@/lib/i18n/translations";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
export const AI_OPS_ACTION_LEASE_MS = 10 * 60 * 1000;
const ACTION_RESULT_WRITE_ATTEMPTS = 5;

function toRecord(row: {
	id: string;
	triggerType: string;
	mode: string;
	status: string;
	findings: Prisma.JsonValue;
	actions: Prisma.JsonValue;
	notes: string | null;
	errorMessage: string | null;
	providerId: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	durationMs: number | null;
	triggeredById: string | null;
	createdAt: Date;
	updatedAt: Date;
}): AiOpsLogRecord {
	const findings = parseFindings(row.findings);
	const actions = parseActions(row.actions, row.mode as AiOpsMode);
	return {
		id: row.id,
		triggerType: row.triggerType as AiOpsTriggerType,
		mode: row.mode as AiOpsMode,
		status: row.status as AiOpsStatus,
		findings,
		actions,
		notes: row.notes,
		errorMessage: row.errorMessage,
		providerId: row.providerId,
		startedAt: row.startedAt ? row.startedAt.toISOString() : null,
		completedAt: row.completedAt ? row.completedAt.toISOString() : null,
		durationMs: row.durationMs,
		triggeredById: row.triggeredById,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function parseFindings(value: Prisma.JsonValue): AiOpsFinding[] {
	if (!Array.isArray(value)) return [];
	const out: AiOpsFinding[] = [];
	for (const raw of value) {
		const parsed = aiOpsFindingSchema.safeParse(raw);
		if (parsed.success) out.push(parsed.data);
	}
	return out;
}

function parseActions(
	value: Prisma.JsonValue,
	mode: AiOpsMode,
): AiOpsRecommendedAction[] | AiOpsExecutedAction[] {
	if (!Array.isArray(value)) return [];
	if (mode === "autonomous") {
		const out: AiOpsExecutedAction[] = [];
		for (const raw of value) {
			const parsed = aiOpsExecutedActionSchema.safeParse(raw);
			if (parsed.success) out.push(parsed.data);
		}
		return out;
	}
	const out: AiOpsRecommendedAction[] = [];
	for (const raw of value) {
		const parsed = aiOpsRecommendedActionSchema.safeParse(raw);
		if (parsed.success) out.push(parsed.data);
	}
	return out;
}

export interface ListAiOpsLogsInput {
	mode?: AiOpsMode;
	status?: AiOpsStatus;
	triggerType?: AiOpsTriggerType;
	limit?: number;
}

export async function listAiOpsLogs(
	input: ListAiOpsLogsInput = {},
): Promise<AiOpsLogRecord[]> {
	const limit = Math.min(
		Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1),
		MAX_LIST_LIMIT,
	);
	const rows = await prisma.aiOpsLog.findMany({
		where: {
			mode: input.mode,
			status: input.status,
			triggerType: input.triggerType,
		},
		orderBy: { createdAt: "desc" },
		take: limit,
	});
	return rows.map(toRecord);
}

export async function getAiOpsLog(id: string): Promise<AiOpsLogRecord | null> {
	const row = await prisma.aiOpsLog.findUnique({ where: { id } });
	return row ? toRecord(row) : null;
}

export interface CreateAiOpsLogInput {
	triggerType: AiOpsTriggerType;
	mode: AiOpsMode;
	triggeredById?: string | null;
	providerId?: string | null;
	notes?: string | null;
}

export async function createAiOpsLog(
	input: CreateAiOpsLogInput,
): Promise<AiOpsLogRecord> {
	const row = await prisma.aiOpsLog.create({
		data: {
			triggerType: input.triggerType,
			mode: input.mode,
			status: "running",
			findings: [] as unknown as Prisma.InputJsonValue,
			actions: [] as unknown as Prisma.InputJsonValue,
			notes: input.notes ?? null,
			providerId: input.providerId ?? null,
			startedAt: new Date(),
			triggeredById: input.triggeredById ?? null,
		},
	});
	return toRecord(row);
}

export interface CompleteScanInput {
	logId: string;
	status: AiOpsStatus;
	findings: AiOpsFinding[];
	actions: AiOpsRecommendedAction[] | AiOpsExecutedAction[];
	notes?: string | null;
	errorMessage?: string | null;
}

export async function completeScan(input: CompleteScanInput): Promise<AiOpsLogRecord> {
	const startedRow = await prisma.aiOpsLog.findUnique({
		where: { id: input.logId },
		select: { startedAt: true },
	});
	const completedAt = new Date();
	const durationMs = startedRow?.startedAt
		? Math.max(0, completedAt.getTime() - startedRow.startedAt.getTime())
		: null;

	const row = await prisma.aiOpsLog.update({
		where: { id: input.logId },
		data: {
			status: input.status,
			findings: input.findings as unknown as Prisma.InputJsonValue,
			actions: input.actions as unknown as Prisma.InputJsonValue,
			notes: input.notes ?? null,
			errorMessage: input.errorMessage ?? null,
			completedAt,
			durationMs,
		},
	});
	return toRecord(row);
}

export interface ExecuteRecommendationInput {
	logId: string;
	actionId: string;
	/** When true, attempt to execute even if mode is recommendation. */
	forceAutonomous?: boolean;
}

export interface ExecuteRecommendationResult {
	ok: boolean;
	executed: boolean;
	errorMessage?: string;
	action?: AiOpsExecutedAction;
}

/**
 * Approve a recommendation for execution. After approval, the action can be
 * executed without forceAutonomous. This provides the "approve → execute"
 * workflow that the UI "审批" button needs.
 */
export async function approveRecommendation(input: {
	logId: string;
	actionId: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
	const log = await prisma.aiOpsLog.findUnique({ where: { id: input.logId } });
	if (!log) {
		return { ok: false, errorMessage: "Log not found" };
	}
	const actions = parseActions(log.actions, log.mode as AiOpsMode);
	const match = actions.find(
		(a) => (a as { id: string }).id === input.actionId,
	) as AiOpsRecommendedAction | undefined;
	if (!match) {
		return { ok: false, errorMessage: "Recommendation not found" };
	}
	if (!match.requiresApproval) {
		return { ok: false, errorMessage: "This recommendation does not require approval" };
	}

	// Atomic compare-and-swap: guard against two approvers acting on the
	// same recommendation near-simultaneously (race loss). Use updatedAt
	// as the optimistic-lock version token — updateMany only matches if
	// no other write has touched the row since our read.
	const actionsAsPlain = actions as { id: string; approved?: boolean; requiresApproval?: boolean }[];
	if (Boolean(actionsAsPlain.find((a) => a.id === input.actionId)?.approved)) {
		return { ok: false, errorMessage: "This recommendation has already been approved" };
	}

	const updatedActions = actions.map((a) => {
		if ((a as { id: string }).id === input.actionId) {
			return { ...a, approved: true } as AiOpsRecommendedAction;
		}
		return a;
	});

	const claimed = await prisma.aiOpsLog.updateMany({
		where: { id: log.id, updatedAt: log.updatedAt },
		data: {
			actions: updatedActions as unknown as Prisma.InputJsonValue,
		},
	});

	if (claimed.count === 0) {
		return {
			ok: false,
			errorMessage: "This recommendation was just approved by another approver; please refresh and try again",
		};
	}

	return { ok: true };
}

export async function executeRecommendation(
	input: ExecuteRecommendationInput,
): Promise<ExecuteRecommendationResult> {
	const log = await prisma.aiOpsLog.findUnique({ where: { id: input.logId } });
	if (!log) {
		return { ok: false, executed: false, errorMessage: "Log not found" };
	}
	const actions = parseActions(log.actions, log.mode as AiOpsMode);
	const match = actions.find(
		(a) => (a as { id: string }).id === input.actionId,
	) as AiOpsRecommendedAction | undefined;
	if (!match) {
		return { ok: false, executed: false, errorMessage: "Recommendation not found" };
	}
	if ("executedAt" in match && match.executedAt) {
		const inProgress =
			("result" in match && match.result === "in_progress") ||
			("executed" in match && match.executed === false && !match.errorMessage);
		const leaseStartedAt = Date.parse(match.executedAt);
		const leaseExpired =
			inProgress &&
			Number.isFinite(leaseStartedAt) &&
			Date.now() - leaseStartedAt >= AI_OPS_ACTION_LEASE_MS;
		if (!leaseExpired) {
			return {
				ok: true,
				executed: false,
				errorMessage: inProgress
					? "Recommendation is already being executed; refresh to view the latest result"
					: "Recommendation has already been executed",
			};
		}
	}

	const safeSet = new Set<string>(AI_OPS_SAFE_AUTONOMOUS_ACTIONS);
	const isSafe = safeSet.has(match.action);
	if (!input.forceAutonomous && match.requiresApproval && !match.approved) {
		return {
			ok: true,
			executed: false,
			errorMessage: "Admin approval required; will not execute automatically",
		};
	}
	if (input.forceAutonomous && !isSafe) {
		return {
			ok: true,
			executed: false,
			errorMessage: `Action ${match.action} is not in the autonomous safe set; manual execution required`,
		};
	}

	const claimedAt = new Date();
	const claimedAtIso = claimedAt.toISOString();
	const inProgressLease: AiOpsExecutedAction = {
		id: match.id,
		action: match.action,
		risk: match.risk,
		executed: false,
		executedAt: claimedAtIso,
		result: "in_progress",
	};
	let claimVersion = log.updatedAt;
	let actionsAtClaim = actions;
	let actionClaimed = false;
	for (let attempt = 0; attempt < ACTION_RESULT_WRITE_ATTEMPTS; attempt += 1) {
		const claimedActions = actionsAtClaim.map((action) =>
			action.id === match.id ? inProgressLease : action,
		);
		const claim = await prisma.aiOpsLog.updateMany({
			where: { id: log.id, updatedAt: claimVersion },
			data: {
				updatedAt: claimedAt,
				actions: claimedActions as unknown as Prisma.InputJsonValue,
			},
		});
		if (claim.count === 1) {
			actionClaimed = true;
			break;
		}

		const latest = await prisma.aiOpsLog.findUnique({ where: { id: log.id } });
		if (!latest) break;
		actionsAtClaim = parseActions(latest.actions, latest.mode as AiOpsMode);
		const current = actionsAtClaim.find((action) => action.id === match.id);
		if (!current) break;
		if (current.executedAt) {
			const leaseStartedAt = Date.parse(current.executedAt);
			const inProgress =
				current.result === "in_progress" ||
				(current.executed === false && !current.errorMessage);
			const expired =
				inProgress &&
				Number.isFinite(leaseStartedAt) &&
				Date.now() - leaseStartedAt >= AI_OPS_ACTION_LEASE_MS;
			if (!expired) {
				return {
					ok: true,
					executed: false,
					errorMessage: inProgress
						? "Recommendation is already being executed; refresh to view the latest result"
						: "Recommendation has already been executed",
				};
			}
		}
		claimVersion = latest.updatedAt;
	}
	if (!actionClaimed) {
		return {
			ok: false,
			executed: false,
			errorMessage: t("backend.ai.recommendationChangedConcurrently"),
		};
	}

	const executed = await executeAiOpsAction({
		id: match.id,
		action: match.action,
		risk: match.risk,
	});

	let resultPersisted = false;
	for (let attempt = 0; attempt < ACTION_RESULT_WRITE_ATTEMPTS; attempt += 1) {
		const latest = await prisma.aiOpsLog.findUnique({ where: { id: log.id } });
		if (!latest) break;
		const latestActions = parseActions(latest.actions, latest.mode as AiOpsMode);
		const leasedAction = latestActions.find((action) => action.id === match.id);
		if (!leasedAction || leasedAction.executedAt !== claimedAtIso) break;

		const mergedActions = latestActions.map((action) =>
			action.id === match.id ? executed : action,
		);
		const completedAt = new Date();
		const persisted = await prisma.aiOpsLog.updateMany({
			where: { id: log.id, updatedAt: latest.updatedAt },
			data: {
				updatedAt: completedAt,
				actions: mergedActions as unknown as Prisma.InputJsonValue,
			},
		});
		if (persisted.count === 1) {
			resultPersisted = true;
			break;
		}
	}

	if (!resultPersisted) {
		return {
			ok: false,
			executed: false,
			errorMessage:
				"The action completed but its result could not be saved due to concurrent updates; refresh before retrying",
		};
	}

	return executed.executed
		? { ok: true, executed: true, action: executed }
		: { ok: true, executed: false, errorMessage: executed.errorMessage, action: executed };
}

export interface AiOpsSummary {
	total: number;
	byStatus: Record<AiOpsStatus, number>;
	byMode: Record<AiOpsMode, number>;
	lastScanAt: string | null;
	lastErrorAt: string | null;
}

export async function summariseAiOps(): Promise<AiOpsSummary> {
	const rows = await prisma.aiOpsLog.findMany({
		select: { status: true, mode: true, createdAt: true, errorMessage: true },
		orderBy: { createdAt: "desc" },
		take: 200,
	});
	const byStatus: Record<AiOpsStatus, number> = {
		ok: 0,
		warning: 0,
		error: 0,
		skipped: 0,
		running: 0,
	};
	const byMode: Record<AiOpsMode, number> = {
		recommendation: 0,
		autonomous: 0,
	};
	let lastScanAt: string | null = null;
	let lastErrorAt: string | null = null;
	for (const r of rows) {
		byStatus[r.status as AiOpsStatus] = (byStatus[r.status as AiOpsStatus] ?? 0) + 1;
		byMode[r.mode as AiOpsMode] = (byMode[r.mode as AiOpsMode] ?? 0) + 1;
		if (!lastScanAt) lastScanAt = r.createdAt.toISOString();
		if (!lastErrorAt && r.errorMessage) lastErrorAt = r.createdAt.toISOString();
	}
	return { total: rows.length, byStatus, byMode, lastScanAt, lastErrorAt };
}
