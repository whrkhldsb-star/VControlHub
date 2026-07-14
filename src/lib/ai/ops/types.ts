/**
 * TR-032 E02: Smart AI ops — types.
 *
 * Two operating modes:
 *   - "recommendation" : AI produces findings + suggested actions; admin must
 *                        explicitly approve each one before any side effect.
 *   - "autonomous"     : AI produces findings + executes a constrained set of
 *                        safe actions (those that do NOT require human
 *                        approval). Anything outside the safe set is recorded
 *                        as a recommendation instead.
 *
 * Source of truth is the `ai_ops_logs` Prisma table. Every scan / manual
 * trigger / recommendation follow-up writes one row with a status.
 */
import { Prisma } from "@prisma/client";

export const AI_OPS_MODE_VALUES = ["recommendation", "autonomous"] as const;
export type AiOpsMode = (typeof AI_OPS_MODE_VALUES)[number];

export const AI_OPS_TRIGGER_VALUES = [
	"scheduled",
	"manual",
	"recommendation_followup",
] as const;
export type AiOpsTriggerType = (typeof AI_OPS_TRIGGER_VALUES)[number];

export const AI_OPS_STATUS_VALUES = [
	"ok",
	"warning",
	"error",
	"skipped",
	"running",
] as const;
export type AiOpsStatus = (typeof AI_OPS_STATUS_VALUES)[number];

export const AI_OPS_FINDING_SEVERITY_VALUES = [
	"info",
	"warning",
	"critical",
] as const;
export type AiOpsFindingSeverity =
	(typeof AI_OPS_FINDING_SEVERITY_VALUES)[number];

/** A single finding the AI surfaces during a scan. */
export interface AiOpsFinding {
	id: string;
	severity: AiOpsFindingSeverity;
	title: string;
	body: string;
	/** Free-form hint at where the finding came from (e.g. "alert.rules:high-cpu"). */
	source?: string;
	/** Free-form pointer to a resource (e.g. "server:abc", "share:xyz"). */
	resourceRef?: string;
}

/** Recommendation (mode=recommendation) — admin must approve to act. */
export interface AiOpsRecommendedAction {
	id: string;
	action: string;
	risk: "low" | "medium" | "high";
	requiresApproval: boolean;
	reason?: string;
	/** Set to true after an admin approves this recommendation for execution. */
	approved?: boolean;
}

/** Autonomous execution record (mode=autonomous) — already executed or attempted. */
export interface AiOpsExecutedAction {
	id: string;
	action: string;
	risk: "low" | "medium" | "high";
	executed: boolean;
	executedAt?: string;
	result?: string;
	errorMessage?: string;
}

/** Shape of the log row as exposed to UI / API callers. */
export interface AiOpsLogRecord {
	id: string;
	triggerType: AiOpsTriggerType;
	mode: AiOpsMode;
	status: AiOpsStatus;
	findings: AiOpsFinding[];
	actions: AiOpsRecommendedAction[] | AiOpsExecutedAction[];
	notes: string | null;
	errorMessage: string | null;
	providerId: string | null;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
	triggeredById: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Job type for the durable scan worker. */
export const AI_OPS_SCAN_JOB_TYPE = "ai.ops.scan";

/** Safe action set — these can run autonomously without explicit approval. */
export const AI_OPS_SAFE_AUTONOMOUS_ACTIONS = [
	"alert.evaluate",
	"cache.purge:stale",
] as const;
export type AiOpsSafeAutonomousAction =
	(typeof AI_OPS_SAFE_AUTONOMOUS_ACTIONS)[number];

/** Default scan schedule (24h format, local time). 02:00 is the chosen quiet hour. */
export const AI_OPS_DEFAULT_SCHEDULE_HOUR = 2;

export type AiOpsLogJson = Prisma.JsonValue;

export function isAiOpsLogJsonArray<T>(value: T): T {
	return value;
}
