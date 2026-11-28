import { describe, expect, it } from "vitest";

import {
	type AiCapabilities,
	DEFAULT_AI_CAPABILITIES,
	defaultFullAutoTtl,
	formatCountdown,
	fullAutoTtlOptions,
	modeLockReason,
	nextCycleMode,
	permittedModes,
	predictInlineExecution,
	resolveEffectiveMode,
} from "../ai-automation-mode";

const caps = (overrides: Partial<AiCapabilities> = {}): AiCapabilities => ({
	...DEFAULT_AI_CAPABILITIES,
	canAuto: true,
	canFullAuto: true,
	canExecute: true,
	aiMaxAutomationMode: "full_auto",
	aiCommandPolicy: "high_risk",
	...overrides,
});

/**
 * The switcher offers what the server would accept: PATCH /api/ai/conversations/[id] refuses a mode above the
 * platform ceiling or the account's permissions, so the page must lock those rather than send them.
 */
describe("AI working mode rules (client mirror of lib/ai/execution-mode)", () => {
	it("permits Plan and Confirm to everyone, Auto and Full auto by permission and ceiling", () => {
		expect(permittedModes(DEFAULT_AI_CAPABILITIES)).toEqual(["PLAN_ONLY", "ASSISTED"]);
		expect(permittedModes(caps())).toEqual(["PLAN_ONLY", "ASSISTED", "AUTO", "FULL_AUTO"]);
		expect(permittedModes(caps({ canFullAuto: false }))).toEqual(["PLAN_ONLY", "ASSISTED", "AUTO"]);
		// ai:action:full-auto implies Auto, as userModeCeiling does.
		expect(permittedModes(caps({ canAuto: false }))).toEqual(["PLAN_ONLY", "ASSISTED", "AUTO", "FULL_AUTO"]);
		// Without command:execute nothing above Confirm runs.
		expect(permittedModes(caps({ canExecute: false }))).toEqual(["PLAN_ONLY", "ASSISTED"]);
		expect(permittedModes(caps({ aiMaxAutomationMode: "plan" }))).toEqual(["PLAN_ONLY"]);
	});

	it("names the platform ceiling before the missing permission", () => {
		expect(modeLockReason("FULL_AUTO", caps({ aiMaxAutomationMode: "auto", canFullAuto: false }))).toBe("platform_ceiling");
		expect(modeLockReason("FULL_AUTO", caps({ canFullAuto: false }))).toBe("missing_permission");
		expect(modeLockReason("AUTO", caps({ canExecute: false }))).toBe("missing_permission");
		expect(modeLockReason("ASSISTED", caps({ aiMaxAutomationMode: "plan" }))).toBe("platform_ceiling");
		expect(modeLockReason("PLAN_ONLY", caps({ aiMaxAutomationMode: "plan" }))).toBeNull();
	});

	it("reports a downgrade and why: an ended Full auto window, the ceiling, the account", () => {
		const now = Date.parse("2026-11-28T10:00:00.000Z");
		const active = resolveEffectiveMode({ requested: "FULL_AUTO", expiresAt: "2026-11-28T10:10:00.000Z", caps: caps(), now });
		expect(active).toMatchObject({ effective: "FULL_AUTO", downgraded: false, remainingMs: 600_000 });

		const expired = resolveEffectiveMode({ requested: "FULL_AUTO", expiresAt: "2026-11-28T09:59:59.000Z", caps: caps(), now });
		expect(expired).toMatchObject({ effective: "ASSISTED", downgraded: true, reasons: ["expired"], remainingMs: null });

		const ceiling = resolveEffectiveMode({ requested: "FULL_AUTO", expiresAt: "2026-11-28T10:10:00.000Z", caps: caps({ aiMaxAutomationMode: "auto" }), now });
		expect(ceiling).toMatchObject({ effective: "AUTO", downgraded: true, reasons: ["platform_ceiling"] });

		const revoked = resolveEffectiveMode({ requested: "AUTO", caps: caps({ canAuto: false, canFullAuto: false }), now });
		expect(revoked).toMatchObject({ effective: "ASSISTED", downgraded: true, reasons: ["missing_permission"] });

		// An unknown or missing mode is Confirm, the default.
		expect(resolveEffectiveMode({ requested: undefined, caps: caps(), now })).toMatchObject({ requested: "ASSISTED", effective: "ASSISTED", downgraded: false });
	});

	it("cycles through the permitted modes and wraps around (Shift+Tab)", () => {
		const all = caps();
		expect(nextCycleMode("PLAN_ONLY", all)).toBe("ASSISTED");
		expect(nextCycleMode("ASSISTED", all)).toBe("AUTO");
		expect(nextCycleMode("AUTO", all)).toBe("FULL_AUTO");
		expect(nextCycleMode("FULL_AUTO", all)).toBe("PLAN_ONLY");
		// A locked mode is skipped.
		expect(nextCycleMode("ASSISTED", caps({ canFullAuto: false, canAuto: false }))).toBe("PLAN_ONLY");
		// Nothing to cycle between.
		expect(nextCycleMode("PLAN_ONLY", caps({ aiMaxAutomationMode: "plan" }))).toBeNull();
	});

	it("offers 15 / 30 / 60 minute Full auto windows, capped by the platform maximum", () => {
		expect(fullAutoTtlOptions(60)).toEqual([15, 30, 60]);
		expect(fullAutoTtlOptions(45)).toEqual([15, 30]);
		expect(fullAutoTtlOptions(10)).toEqual([10]);
		expect(defaultFullAutoTtl({ defaultFullAutoTtlMinutes: 30, maxFullAutoTtlMinutes: 60 })).toBe(30);
		expect(defaultFullAutoTtl({ defaultFullAutoTtlMinutes: 30, maxFullAutoTtlMinutes: 20 })).toBe(15);
	});

	it("formats the countdown as mm:ss, and h:mm:ss past the hour", () => {
		expect(formatCountdown(65_000)).toBe("01:05");
		expect(formatCountdown(1_000)).toBe("00:01");
		expect(formatCountdown(-5)).toBe("00:00");
		expect(formatCountdown(3_661_000)).toBe("1:01:01");
	});

	it("predicts whether a restored card's confirmation runs now or goes to another reviewer", () => {
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "never" }), riskLevel: "high" })).toBe(true);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "high_risk" }), riskLevel: "medium" })).toBe(true);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "high_risk" }), riskLevel: "high" })).toBe(false);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "always" }), riskLevel: "low" })).toBe(false);
		// A platform admin reviews their own; an approver too under the "approvers" self-review policy.
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "always", isPlatformAdmin: true }), riskLevel: "low" })).toBe(true);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "always", selfReviewPolicy: "approvers", canApprove: true }), riskLevel: "low" })).toBe(true);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "never" }), riskLevel: "critical", denylisted: true })).toBe(true);
		expect(predictInlineExecution({ caps: caps({ aiCommandPolicy: "high_risk" }), riskLevel: "low", denylisted: true })).toBe(false);
		// Without command:execute every confirmation is a request.
		expect(predictInlineExecution({ caps: caps({ canExecute: false, aiCommandPolicy: "never" }), riskLevel: "low" })).toBe(false);
	});
});
