/**
 * TR-032 E02: Smart AI ops — zod schemas.
 *
 * Validation lives here (not in the route handler) so the service layer
 * can re-use the same shape for any direct programmatic call (e.g. the
 * scan worker ingesting a list of findings, or a manual "execute
 * recommendation" call from the UI).
 */
import { z } from "zod";

import {
	AI_OPS_FINDING_SEVERITY_VALUES,
	AI_OPS_MODE_VALUES,
	AI_OPS_SAFE_AUTONOMOUS_ACTIONS,
	AI_OPS_STATUS_VALUES,
	AI_OPS_TRIGGER_VALUES,
} from "./types";

export const aiOpsModeSchema = z.enum(AI_OPS_MODE_VALUES);
export const aiOpsTriggerSchema = z.enum(AI_OPS_TRIGGER_VALUES);
export const aiOpsStatusSchema = z.enum(AI_OPS_STATUS_VALUES);
export const aiOpsFindingSeveritySchema = z.enum(AI_OPS_FINDING_SEVERITY_VALUES);

export const aiOpsFindingSchema = z.object({
	id: z.string().min(1, "finding.id 不能为空").max(128),
	severity: aiOpsFindingSeveritySchema,
	title: z.string().min(1, "finding.title 不能为空").max(256),
	body: z.string().max(4000).default(""),
	source: z.string().max(256).optional(),
	resourceRef: z.string().max(256).optional(),
});

export const aiOpsRecommendedActionSchema = z.object({
	id: z.string().min(1, "action.id 不能为空").max(128),
	action: z.string().min(1, "action.action 不能为空").max(256),
	risk: z.enum(["low", "medium", "high"]),
	requiresApproval: z.boolean().default(true),
	reason: z.string().max(1000).optional(),
});

export const aiOpsExecutedActionSchema = z.object({
	id: z.string().min(1).max(128),
	action: z.string().min(1).max(256),
	risk: z.enum(["low", "medium", "high"]),
	executed: z.boolean(),
	executedAt: z.string().optional(),
	result: z.string().max(4000).optional(),
	errorMessage: z.string().max(4000).optional(),
});

/** Schema for the body of a manual scan trigger. */
export const triggerAiOpsScanSchema = z.object({
	mode: aiOpsModeSchema.optional(),
	notes: z.string().max(2000).optional(),
});

/** Schema for the body of an "execute recommendation" call. */
export const executeRecommendationSchema = z.object({
	actionId: z.string().min(1, "actionId 不能为空"),
	forceAutonomous: z.boolean().optional(),
});

/** Schema for the body of a "set mode" settings call.
 *  `providerId` may be:
 *    - omitted (`undefined`) → leave the stored value unchanged
 *    - empty string `""`    → clear the stored provider
 *    - any non-empty value matching the route-level pattern → set the provider
 */
export const aiOpsModeSettingSchema = z.object({
	mode: aiOpsModeSchema,
	providerId: z.string().max(64).optional(),
});

/** Whitelist for autonomous safe actions. */
export const aiOpsSafeAutonomousActionSchema = z.enum(AI_OPS_SAFE_AUTONOMOUS_ACTIONS);
