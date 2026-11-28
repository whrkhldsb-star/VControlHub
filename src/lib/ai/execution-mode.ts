/**
 * Pure AI execution mode & auto-execution decision rules.
 *
 * Hierarchy: PLAN_ONLY (0) < ASSISTED (1) < AUTO (2) < FULL_AUTO (3).
 *
 * Effective mode is ALWAYS bounded by the lowest of:
 * 1. Conversation's requested mode
 * 2. Platform ceiling (`ai.maxAutomationMode`)
 * 3. User's live RBAC permissions (`ai:action:auto` + `command:execute`, or
 *    `ai:action:full-auto` + `command:execute`)
 * 4. API bearer token cap (`ASSISTED` max)
 * 5. Expiry (`automationModeExpiresAt` elapsed -> falls back to `ASSISTED`)
 */
import type { AiAutomationMode } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import type { ApprovalPolicySnapshot, MaxAiAutomationMode } from "@/lib/command/approval-policy";
import { isHighOrCriticalRisk, type CommandRiskLevel } from "@/lib/command/risk-classifier";
import type { HostedActionType } from "./hosted-tools";

export const MAX_MUTATING_STEPS_PER_TURN = 6;
export const MAX_FULL_AUTO_TTL_MINUTES = 60;
export const DEFAULT_FULL_AUTO_TTL_MINUTES = 30;
/** Well below the 90-minute chat-generation lock expiry. */
export const MAX_INLINE_TURN_WAIT_BUDGET_MS = 10 * 60_000;

export const MODE_RANK: Record<AiAutomationMode, number> = {
  PLAN_ONLY: 0,
  ASSISTED: 1,
  AUTO: 2,
  FULL_AUTO: 3,
};

const RANK_TO_MODE: Record<number, AiAutomationMode> = {
  0: "PLAN_ONLY",
  1: "ASSISTED",
  2: "AUTO",
  3: "FULL_AUTO",
};

export function mapSettingCeilingToMode(ceiling: MaxAiAutomationMode): AiAutomationMode {
  switch (ceiling) {
    case "plan":
      return "PLAN_ONLY";
    case "confirm":
      return "ASSISTED";
    case "auto":
      return "AUTO";
    case "full_auto":
      return "FULL_AUTO";
    default:
      return "ASSISTED";
  }
}

export type ModeSession = {
  userId: string;
  roles: RoleKey[];
  permissions?: Permission[];
  currentTeamId?: string | null;
};

export type EffectiveModeDowngradeReason =
  | "platform_ceiling"
  | "missing_permission"
  | "api_token_cap"
  | "expired"
  | "stream_start_cap";

export type EffectiveAutomationModeResult = {
  effectiveMode: AiAutomationMode;
  requestedMode: AiAutomationMode;
  userCeiling: AiAutomationMode;
  platformCeiling: AiAutomationMode;
  downgraded: boolean;
  reasons: EffectiveModeDowngradeReason[];
};

export function userModeCeiling(session: ModeSession, viaToken = false): AiAutomationMode {
  if (viaToken) return "ASSISTED";
  const canExecute = sessionHasPermission(session, "command:execute");
  if (!canExecute) return "ASSISTED";
  if (sessionHasPermission(session, "ai:action:full-auto")) return "FULL_AUTO";
  if (sessionHasPermission(session, "ai:action:auto")) return "AUTO";
  return "ASSISTED";
}

export function minAutomationMode(a: AiAutomationMode, b: AiAutomationMode): AiAutomationMode {
  return RANK_TO_MODE[Math.min(MODE_RANK[a], MODE_RANK[b])] ?? "ASSISTED";
}

export function resolveEffectiveAutomationMode(input: {
  requestedMode: AiAutomationMode;
  expiresAt?: Date | string | null;
  policies: ApprovalPolicySnapshot;
  session: ModeSession;
  viaToken?: boolean;
  now?: Date;
  streamStartMode?: AiAutomationMode;
}): EffectiveAutomationModeResult {
  const now = input.now ?? new Date();
  const platformCeiling = mapSettingCeilingToMode(input.policies.aiMaxAutomationMode);
  const uCeiling = userModeCeiling(input.session, Boolean(input.viaToken));
  const reasons: EffectiveModeDowngradeReason[] = [];

  let rank = MODE_RANK[input.requestedMode] ?? MODE_RANK.ASSISTED;

  if (input.requestedMode === "FULL_AUTO" && input.expiresAt) {
    const exp = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
      rank = Math.min(rank, MODE_RANK.ASSISTED);
      reasons.push("expired");
    }
  }

  if (input.viaToken && rank > MODE_RANK.ASSISTED) {
    rank = MODE_RANK.ASSISTED;
    reasons.push("api_token_cap");
  }

  if (rank > MODE_RANK[platformCeiling]) {
    rank = MODE_RANK[platformCeiling];
    reasons.push("platform_ceiling");
  }

  if (rank > MODE_RANK[uCeiling]) {
    rank = MODE_RANK[uCeiling];
    reasons.push("missing_permission");
  }

  if (input.streamStartMode && rank > MODE_RANK[input.streamStartMode]) {
    rank = MODE_RANK[input.streamStartMode];
    reasons.push("stream_start_cap");
  }

  const effectiveMode = RANK_TO_MODE[rank] ?? "ASSISTED";
  return {
    effectiveMode,
    requestedMode: input.requestedMode,
    userCeiling: uCeiling,
    platformCeiling,
    downgraded: effectiveMode !== input.requestedMode,
    reasons,
  };
}

/** Lasting automation tools always show an explicit confirmation card regardless of mode. */
export const ALWAYS_CONFIRM_ACTION_TYPES = new Set<HostedActionType>([
  "create_automation_task",
  "manage_cron",
  "run_playbook",
]);

/** Server-mutating tools eligible for AUTO / FULL_AUTO inline execution via CommandRequest. */
export const INLINE_MUTATING_ACTION_TYPES = new Set<HostedActionType>([
  "execute_command",
  "restart_service",
  "modify_config",
  "deploy_docker",
]);

export type AutoExecutionDecision =
  | { autoRun: true; decisionSource: "AI_MODE_AUTO" | "AI_MODE_FULL_AUTO" }
  | { autoRun: false; reason: string };

/**
 * Decide whether a single mutating tool call may auto-run inline during the
 * chat stream, or must pause and show an inline confirmation card.
 */
export function decideAiAutoExecution(input: {
  effectiveMode: AiAutomationMode;
  actionType: HostedActionType;
  effectiveRisk: CommandRiskLevel;
  denylisted: boolean;
  policies: ApprovalPolicySnapshot;
  submitterMayExecute: boolean;
  targetServerId: string | null;
  pinnedServerIds: readonly string[];
  hasSelectedCustomer: boolean;
  mutatingStepsThisTurn: number;
}): AutoExecutionDecision {
  if (input.effectiveMode !== "AUTO" && input.effectiveMode !== "FULL_AUTO") {
    return { autoRun: false, reason: "mode_requires_confirm" };
  }
  if (!input.submitterMayExecute) {
    return { autoRun: false, reason: "no_execute_permission" };
  }
  if (ALWAYS_CONFIRM_ACTION_TYPES.has(input.actionType)) {
    return { autoRun: false, reason: "lasting_automation_always_confirms" };
  }
  if (!INLINE_MUTATING_ACTION_TYPES.has(input.actionType)) {
    return { autoRun: false, reason: "not_inline_mutating_tool" };
  }
  if (input.mutatingStepsThisTurn >= MAX_MUTATING_STEPS_PER_TURN) {
    return { autoRun: false, reason: "turn_mutation_cap_reached" };
  }
  // Never auto-run denylisted catastrophic commands even in FULL_AUTO
  if (input.denylisted) {
    return { autoRun: false, reason: "denylisted_command" };
  }
  // Platform AI policy `always` overrides AUTO / FULL_AUTO completely
  const aiPolicy =
    input.policies.aiCommandApprovalPolicy === "inherit"
      ? input.policies.commandApprovalPolicy
      : input.policies.aiCommandApprovalPolicy;
  if (aiPolicy === "always") {
    return { autoRun: false, reason: "policy_always" };
  }
  // If pinned servers exist, target must be in the pinned set
  if (input.pinnedServerIds.length > 0 && (!input.targetServerId || !input.pinnedServerIds.includes(input.targetServerId))) {
    return { autoRun: false, reason: "target_outside_pinned_servers" };
  }
  // FULL_AUTO with no active customer requires pinned servers so platform admin cannot span all customers blindly
  if (input.effectiveMode === "FULL_AUTO" && !input.hasSelectedCustomer && input.pinnedServerIds.length === 0) {
    return { autoRun: false, reason: "full_auto_requires_customer_or_pins" };
  }

  if (input.effectiveMode === "AUTO") {
    if (isHighOrCriticalRisk(input.effectiveRisk)) {
      return { autoRun: false, reason: "risk_requires_confirm_in_auto" };
    }
    return { autoRun: true, decisionSource: "AI_MODE_AUTO" };
  }

  // FULL_AUTO
  if (input.effectiveRisk === "critical" && !input.policies.aiFullAutoAllowCritical) {
    return { autoRun: false, reason: "critical_requires_confirm" };
  }
  return { autoRun: true, decisionSource: "AI_MODE_FULL_AUTO" };
}

export function maxToolRoundsForMode(mode: AiAutomationMode): number {
  if (mode === "FULL_AUTO") return 10;
  if (mode === "AUTO") return 8;
  return 5;
}
