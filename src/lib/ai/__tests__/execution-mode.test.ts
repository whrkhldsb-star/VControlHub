import { describe, expect, it } from "vitest";
import {
  decideAiAutoExecution,
  MAX_MUTATING_STEPS_PER_TURN,
  resolveEffectiveAutomationMode,
} from "../execution-mode";
import { DEFAULT_APPROVAL_POLICIES } from "@/lib/command/approval-policy";
import { getPermissionsFromRoles } from "@/lib/auth/rbac";

const adminSession = { userId: "admin-1", roles: ["admin" as const], permissions: getPermissionsFromRoles(["admin"]), currentTeamId: "team-1" };
const operatorSession = { userId: "op-1", roles: ["operator" as const], permissions: getPermissionsFromRoles(["operator"]), currentTeamId: "team-1" };
const viewerSession = { userId: "v-1", roles: ["viewer" as const], permissions: getPermissionsFromRoles(["viewer"]), currentTeamId: "team-1" };

describe("resolveEffectiveAutomationMode", () => {
  it("enforces permissions, platform ceiling, bearer-token cap, and expiry", () => {
    const adminFull = resolveEffectiveAutomationMode({
      requestedMode: "FULL_AUTO",
      expiresAt: new Date(Date.now() + 10 * 60_000),
      policies: DEFAULT_APPROVAL_POLICIES,
      session: adminSession,
    });
    expect(adminFull.effectiveMode).toBe("FULL_AUTO");
    expect(adminFull.downgraded).toBe(false);

    // Operator has ai:action:auto + command:execute, not full-auto
    const opFull = resolveEffectiveAutomationMode({
      requestedMode: "FULL_AUTO",
      policies: DEFAULT_APPROVAL_POLICIES,
      session: operatorSession,
    });
    expect(opFull.effectiveMode).toBe("AUTO");
    expect(opFull.reasons).toContain("missing_permission");

    // Viewer cannot exceed ASSISTED
    const viewerAuto = resolveEffectiveAutomationMode({
      requestedMode: "AUTO",
      policies: DEFAULT_APPROVAL_POLICIES,
      session: viewerSession,
    });
    expect(viewerAuto.effectiveMode).toBe("ASSISTED");

    // Expired FULL_AUTO drops back to ASSISTED
    const expired = resolveEffectiveAutomationMode({
      requestedMode: "FULL_AUTO",
      expiresAt: new Date(Date.now() - 1_000),
      policies: DEFAULT_APPROVAL_POLICIES,
      session: adminSession,
    });
    expect(expired.effectiveMode).toBe("ASSISTED");
    expect(expired.reasons).toContain("expired");

    // Bearer tokens are capped at ASSISTED
    const tokenCapped = resolveEffectiveAutomationMode({
      requestedMode: "AUTO",
      policies: DEFAULT_APPROVAL_POLICIES,
      session: adminSession,
      viaToken: true,
    });
    expect(tokenCapped.effectiveMode).toBe("ASSISTED");
    expect(tokenCapped.reasons).toContain("api_token_cap");

    // Platform ceiling overrides user permissions
    const ceilingCapped = resolveEffectiveAutomationMode({
      requestedMode: "FULL_AUTO",
      policies: { ...DEFAULT_APPROVAL_POLICIES, aiMaxAutomationMode: "confirm" },
      session: adminSession,
    });
    expect(ceilingCapped.effectiveMode).toBe("ASSISTED");
    expect(ceilingCapped.reasons).toContain("platform_ceiling");
  });
});

describe("decideAiAutoExecution", () => {
  it("allows low/medium in AUTO, blocks high/critical, and blocks denylisted commands even in FULL_AUTO", () => {
    expect(
      decideAiAutoExecution({
        effectiveMode: "AUTO",
        actionType: "execute_command",
        effectiveRisk: "medium",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: [],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }),
    ).toEqual({ autoRun: true, decisionSource: "AI_MODE_AUTO" });

    expect(
      decideAiAutoExecution({
        effectiveMode: "AUTO",
        actionType: "restart_service",
        effectiveRisk: "high",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: [],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }).autoRun,
    ).toBe(false);

    // FULL_AUTO runs high risk, blocks denylisted critical commands even if aiFullAutoAllowCritical is true
    expect(
      decideAiAutoExecution({
        effectiveMode: "FULL_AUTO",
        actionType: "restart_service",
        effectiveRisk: "high",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: [],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }),
    ).toEqual({ autoRun: true, decisionSource: "AI_MODE_FULL_AUTO" });

    expect(
      decideAiAutoExecution({
        effectiveMode: "FULL_AUTO",
        actionType: "execute_command",
        effectiveRisk: "critical",
        denylisted: true,
        policies: { ...DEFAULT_APPROVAL_POLICIES, aiFullAutoAllowCritical: true },
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: ["srv-1"],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }).autoRun,
    ).toBe(false);

    // Pinned server boundary & turn step cap
    expect(
      decideAiAutoExecution({
        effectiveMode: "AUTO",
        actionType: "execute_command",
        effectiveRisk: "low",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-other",
        pinnedServerIds: ["srv-1"],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }).autoRun,
    ).toBe(false);

    expect(
      decideAiAutoExecution({
        effectiveMode: "AUTO",
        actionType: "execute_command",
        effectiveRisk: "low",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: [],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: MAX_MUTATING_STEPS_PER_TURN,
      }).autoRun,
    ).toBe(false);

    // Lasting automations always confirm
    expect(
      decideAiAutoExecution({
        effectiveMode: "FULL_AUTO",
        actionType: "run_playbook",
        effectiveRisk: "low",
        denylisted: false,
        policies: DEFAULT_APPROVAL_POLICIES,
        submitterMayExecute: true,
        targetServerId: "srv-1",
        pinnedServerIds: ["srv-1"],
        hasSelectedCustomer: true,
        mutatingStepsThisTurn: 0,
      }).autoRun,
    ).toBe(false);
  });
});
