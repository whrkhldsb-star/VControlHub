/**
 * Pure command approval policy & origin decision engine.
 *
 * Replaces the legacy actor-only `isProtectedByApproval` check across:
 * - POST /api/commands & POST /api/commands/preview
 * - createCommandRequest (single server choke point)
 * - AI chat inline confirm, AUTO, and FULL_AUTO
 * - Deployments & rollbacks
 * - Scheduled tasks & AI automations
 */
import type { CommandOrigin } from "@prisma/client";
import { isHighOrCriticalRisk, type CommandRiskLevel } from "./risk-classifier";

export type ApprovalPolicyMode = "always" | "high_risk" | "never";
export type ScopedApprovalPolicyMode = "inherit" | ApprovalPolicyMode;
export type SelfReviewPolicy = "platform_admins" | "approvers";
export type MaxAiAutomationMode = "plan" | "confirm" | "auto" | "full_auto";

export type CommandDecisionSource =
  | "POLICY_DIRECT"
  | "REQUESTER_CONFIRMED"
  | "AI_MODE_AUTO"
  | "AI_MODE_FULL_AUTO"
  | "REVIEWER"
  | "SELF_REVIEW"
  | "STANDING_APPROVAL"
  | "PLAYBOOK_EXEMPT";

export type ApprovalPolicySnapshot = {
  commandApprovalPolicy: ApprovalPolicyMode;
  aiCommandApprovalPolicy: ScopedApprovalPolicyMode;
  deployApprovalPolicy: ScopedApprovalPolicyMode;
  commandSelfReview: SelfReviewPolicy;
  aiMaxAutomationMode: MaxAiAutomationMode;
  aiFullAutoAllowCritical: boolean;
};

export const DEFAULT_APPROVAL_POLICIES: ApprovalPolicySnapshot = {
  commandApprovalPolicy: "never",
  aiCommandApprovalPolicy: "high_risk",
  deployApprovalPolicy: "always",
  commandSelfReview: "platform_admins",
  aiMaxAutomationMode: "full_auto",
  aiFullAutoAllowCritical: false,
};

/** Fail-closed values used whenever DB settings cannot be read or contain invalid data. */
export const FAIL_CLOSED_APPROVAL_POLICIES: ApprovalPolicySnapshot = {
  commandApprovalPolicy: "always",
  aiCommandApprovalPolicy: "always",
  deployApprovalPolicy: "always",
  commandSelfReview: "platform_admins",
  aiMaxAutomationMode: "confirm",
  aiFullAutoAllowCritical: false,
};

const POLICY_STRICTNESS: Record<ApprovalPolicyMode, number> = {
  never: 0,
  high_risk: 1,
  always: 2,
};

export function stricterPolicy(a: ApprovalPolicyMode, b: ApprovalPolicyMode): ApprovalPolicyMode {
  return POLICY_STRICTNESS[a] >= POLICY_STRICTNESS[b] ? a : b;
}

export function resolveEffectivePolicyForOrigin(
  policies: ApprovalPolicySnapshot,
  origin: CommandOrigin,
): ApprovalPolicyMode {
  switch (origin) {
    case "AI_CHAT":
    case "AI_AUTOMATION":
      return policies.aiCommandApprovalPolicy === "inherit"
        ? policies.commandApprovalPolicy
        : policies.aiCommandApprovalPolicy;
    case "DEPLOYMENT":
    case "DEPLOYMENT_ROLLBACK":
      return policies.deployApprovalPolicy === "inherit"
        ? policies.commandApprovalPolicy
        : policies.deployApprovalPolicy;
    case "USER_UI":
    case "API":
    case "SCHEDULED_TASK":
    case "PLAYBOOK":
    default:
      return policies.commandApprovalPolicy;
  }
}

export type ApprovalDecisionReason =
  | "playbook_exempt"
  | "no_execute_permission"
  | "requested"
  | "denylisted_command"
  | "policy_always"
  | "risk_high"
  | "policy_never"
  | "policy_low_risk";

export type CommandApprovalDecision = {
  requiresApproval: boolean;
  reason: ApprovalDecisionReason;
  effectivePolicy: ApprovalPolicyMode;
};

/**
 * Single authoritative decision rule for whether a command requires human
 * approval before execution.
 *
 * Precedence:
 * 1. PLAYBOOK origin -> exempt (gated by playbook:run at launch).
 * 2. Submitter lacks `command:execute` -> ALWAYS requires approval.
 * 3. Caller explicitly requested review (`requestedReview === true`) -> requires approval.
 * 4. Denylisted critical command under `high_risk` or `always` -> requires approval.
 * 5. Effective policy is `always` -> requires approval.
 * 6. Effective policy is `high_risk` and risk is high/critical -> requires approval.
 * 7. Otherwise -> direct execution permitted.
 */
export function decideCommandApproval(input: {
  policies: ApprovalPolicySnapshot;
  origin: CommandOrigin;
  riskLevel: CommandRiskLevel;
  denylisted?: boolean;
  submitterMayExecute: boolean;
  requestedReview?: boolean;
}): CommandApprovalDecision {
  const effectivePolicy = resolveEffectivePolicyForOrigin(input.policies, input.origin);

  if (input.origin === "PLAYBOOK") {
    return { requiresApproval: false, reason: "playbook_exempt", effectivePolicy };
  }
  if (!input.submitterMayExecute) {
    return { requiresApproval: true, reason: "no_execute_permission", effectivePolicy };
  }
  if (input.requestedReview === true) {
    return { requiresApproval: true, reason: "requested", effectivePolicy };
  }
  if (effectivePolicy === "always") {
    return { requiresApproval: true, reason: "policy_always", effectivePolicy };
  }
  if (input.denylisted && effectivePolicy !== "never") {
    return { requiresApproval: true, reason: "denylisted_command", effectivePolicy };
  }
  if (effectivePolicy === "high_risk" && isHighOrCriticalRisk(input.riskLevel)) {
    return { requiresApproval: true, reason: "risk_high", effectivePolicy };
  }
  if (effectivePolicy === "never") {
    return { requiresApproval: false, reason: "policy_never", effectivePolicy };
  }
  return { requiresApproval: false, reason: "policy_low_risk", effectivePolicy };
}

/**
 * Infer a truthful CommandOrigin for legacy CommandRequest rows written before
 * the `origin` column existed (no migration backfill required).
 */
export function inferCommandOrigin(row: {
  origin?: CommandOrigin | null;
  idempotencyKey?: string | null;
  initiatedByType?: string | null;
}): CommandOrigin {
  if (row.origin) return row.origin;
  const key = row.idempotencyKey ?? "";
  if (key.startsWith("deployment-rollback:")) return "DEPLOYMENT_ROLLBACK";
  if (key.startsWith("deployment:")) return "DEPLOYMENT";
  if (key.startsWith("ai-hosted-action:")) return "AI_CHAT";
  if (key.startsWith("ai-automation:")) return "AI_AUTOMATION";
  if (key.startsWith("scheduled-task:")) return "SCHEDULED_TASK";
  if (key.startsWith("playbook:")) return "PLAYBOOK";
  if (key.startsWith("api:")) return "API";
  if (row.initiatedByType === "ASSISTANT") return "AI_CHAT";
  return "USER_UI";
}

export function isAiCommandOrigin(origin: CommandOrigin): boolean {
  return origin === "AI_CHAT" || origin === "AI_AUTOMATION";
}
