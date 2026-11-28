import { describe, expect, it } from "vitest";
import {
  decideCommandApproval,
  DEFAULT_APPROVAL_POLICIES,
  FAIL_CLOSED_APPROVAL_POLICIES,
  inferCommandOrigin,
} from "../approval-policy";

describe("decideCommandApproval", () => {
  it("always requires approval when submitter lacks command:execute", () => {
    const result = decideCommandApproval({
      policies: { ...DEFAULT_APPROVAL_POLICIES, commandApprovalPolicy: "never" },
      origin: "USER_UI",
      riskLevel: "low",
      submitterMayExecute: false,
      requestedReview: false,
    });
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toBe("no_execute_permission");
  });

  it("respects voluntary review request even under policy=never", () => {
    const result = decideCommandApproval({
      policies: { ...DEFAULT_APPROVAL_POLICIES, commandApprovalPolicy: "never" },
      origin: "USER_UI",
      riskLevel: "low",
      submitterMayExecute: true,
      requestedReview: true,
    });
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toBe("requested");
  });

  it("enforces high_risk and always policies even when caller requests direct run", () => {
    const lowUnderHighRisk = decideCommandApproval({
      policies: { ...DEFAULT_APPROVAL_POLICIES, commandApprovalPolicy: "high_risk" },
      origin: "USER_UI",
      riskLevel: "low",
      submitterMayExecute: true,
      requestedReview: false,
    });
    expect(lowUnderHighRisk.requiresApproval).toBe(false);

    const highUnderHighRisk = decideCommandApproval({
      policies: { ...DEFAULT_APPROVAL_POLICIES, commandApprovalPolicy: "high_risk" },
      origin: "USER_UI",
      riskLevel: "high",
      submitterMayExecute: true,
      requestedReview: false,
    });
    expect(highUnderHighRisk.requiresApproval).toBe(true);
    expect(highUnderHighRisk.reason).toBe("risk_high");

    const lowUnderAlways = decideCommandApproval({
      policies: FAIL_CLOSED_APPROVAL_POLICIES,
      origin: "USER_UI",
      riskLevel: "low",
      submitterMayExecute: true,
      requestedReview: false,
    });
    expect(lowUnderAlways.requiresApproval).toBe(true);
    expect(lowUnderAlways.reason).toBe("policy_always");
  });

  it("exempts PLAYBOOK origin and resolves inherit for AI and DEPLOYMENT", () => {
    expect(
      decideCommandApproval({
        policies: FAIL_CLOSED_APPROVAL_POLICIES,
        origin: "PLAYBOOK",
        riskLevel: "critical",
        submitterMayExecute: false,
      }).requiresApproval,
    ).toBe(false);

    const aiInherit = decideCommandApproval({
      policies: { ...DEFAULT_APPROVAL_POLICIES, commandApprovalPolicy: "always", aiCommandApprovalPolicy: "inherit" },
      origin: "AI_CHAT",
      riskLevel: "low",
      submitterMayExecute: true,
    });
    expect(aiInherit.requiresApproval).toBe(true);
    expect(aiInherit.effectivePolicy).toBe("always");
  });

  it("infers legacy origins accurately without mislabeling deployments as AI", () => {
    expect(inferCommandOrigin({ idempotencyKey: "deployment:run_1", initiatedByType: "ASSISTANT" })).toBe("DEPLOYMENT");
    expect(inferCommandOrigin({ idempotencyKey: "deployment-rollback:rb_1", initiatedByType: "ASSISTANT" })).toBe("DEPLOYMENT_ROLLBACK");
    expect(inferCommandOrigin({ idempotencyKey: "ai-hosted-action:act_1", initiatedByType: "ASSISTANT" })).toBe("AI_CHAT");
    expect(inferCommandOrigin({ idempotencyKey: "ai-automation:act_2", initiatedByType: "ASSISTANT" })).toBe("AI_AUTOMATION");
    expect(inferCommandOrigin({ idempotencyKey: "scheduled-task:st_1", initiatedByType: "USER" })).toBe("SCHEDULED_TASK");
    expect(inferCommandOrigin({ idempotencyKey: "playbook:pb_1", initiatedByType: "USER" })).toBe("PLAYBOOK");
  });
});
