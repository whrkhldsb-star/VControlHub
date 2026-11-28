import { describe, expect, it } from "vitest";

import {
	continuationCandidate,
	hostedActionCommandRequestId,
	isCriticalApproval,
	parseRiskReasons,
	pendingApprovalsFromMessages,
	summarizeToolData,
} from "../ai-hosted-action-utils";
import type { Message } from "../ai-types";

const assistant = (id: string, statuses: string[]): Message => ({
	id, conversationId: "conv-1", role: "assistant", content: "", reasoningContent: null, imageUrls: "[]", model: null,
	inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-28T00:00:00.000Z",
	hostedActions: statuses.map((status, index) => ({
		id: `${id}-a${index}`, conversationId: "conv-1", messageId: id, toolCallId: `tc-${index}`, serverId: null, actionType: "execute_command",
		actionName: "Execute command", params: "{}", status: status as never, riskLevel: "low", autoApproved: false, result: null,
		errorMessage: null, createdAt: "2026-11-28T00:00:00.000Z", approvedAt: null, executedAt: null, completedAt: null, server: null,
	})),
});

describe("continuationCandidate", () => {
	it("is the last saved assistant turn with actions, settled once every action is final", () => {
		expect(continuationCandidate([assistant("m1", ["COMPLETED", "REJECTED"])])).toEqual({ messageId: "m1", actionIds: ["m1-a0", "m1-a1"], settled: true });
		expect(continuationCandidate([assistant("m1", ["COMPLETED", "EXECUTING"])])).toMatchObject({ settled: false });
		expect(continuationCandidate([assistant("m1", ["APPROVED"])])).toMatchObject({ settled: false });
	});

	it("skips tool rows and the page's own bubbles, and stops at a user message or a plain answer", () => {
		const tool = { ...assistant("t1", []), role: "tool" };
		const local = { ...assistant("stream-partial-1", []) };
		expect(continuationCandidate([assistant("m1", ["FAILED"]), tool, local])).toMatchObject({ messageId: "m1", settled: true });
		expect(continuationCandidate([assistant("m1", ["FAILED"]), { ...assistant("u1", []), role: "user" }])).toBeNull();
		expect(continuationCandidate([assistant("m1", ["FAILED"]), assistant("m2", [])])).toBeNull();
		expect(continuationCandidate([])).toBeNull();
	});
});

describe("summarizeToolData", () => {
	it("reads a command outcome: exit code, error, and its output's tail", () => {
		const summary = summarizeToolData({ success: false, exitCode: 2, stdout: "a\n", stderr: "boom\n", error: "Command exited with code 2" });
		expect(summary).toEqual({ exitCode: 2, error: "Command exited with code 2", output: "a\nboom" });
		expect(summarizeToolData({ exitCode: null, stdout: "x".repeat(2_000) }).output).toHaveLength(1_201);
	});

	it("counts list-shaped data and keeps the rest for the expandable output", () => {
		expect(summarizeToolData({ servers: [{ id: 1 }, { id: 2 }] })).toMatchObject({ count: 2 });
		expect(summarizeToolData([1, 2, 3])).toMatchObject({ count: 3 });
		expect(summarizeToolData({})).toEqual({});
		expect(summarizeToolData(null)).toEqual({});
		expect(summarizeToolData("plain text")).toEqual({ output: "plain text" });
	});
});

describe("risk details of a card", () => {
	it("parses stored and streamed risk reasons", () => {
		expect(parseRiskReasons(["high.network_tool", 3, ""])).toEqual(["high.network_tool"]);
		expect(parseRiskReasons('["critical.fork_bomb"]')).toEqual(["critical.fork_bomb"]);
		expect(parseRiskReasons("not json")).toEqual([]);
		expect(parseRiskReasons(null)).toEqual([]);
	});

	it("asks for the acknowledgement for critical risk, denylisted commands and critical reasons", () => {
		expect(isCriticalApproval({ riskLevel: "critical" })).toBe(true);
		expect(isCriticalApproval({ riskLevel: "high", denylisted: true })).toBe(true);
		expect(isCriticalApproval({ riskLevel: "high", riskReasons: ["critical.dd_raw_device"] })).toBe(true);
		expect(isCriticalApproval({ riskLevel: "low", effectiveRisk: "critical" })).toBe(true);
		expect(isCriticalApproval({ riskLevel: "high", riskReasons: ["high.network_tool"] })).toBe(false);
	});

	it("restores a card with the server's re-assessed risk and reasons", () => {
		const message = assistant("m1", ["PENDING_APPROVAL"]);
		message.hostedActions![0] = { ...message.hostedActions![0]!, riskLevel: "medium", effectiveRisk: "critical", riskReasons: ["critical.firewall_flush"] };
		expect(pendingApprovalsFromMessages([message])[0]).toMatchObject({
			riskLevel: "critical",
			effectiveRisk: "critical",
			riskReasons: ["critical.firewall_flush"],
			denylisted: true,
		});
	});

	it("finds an action's command request in its column or, for older cards, in its result", () => {
		expect(hostedActionCommandRequestId({ commandRequestId: "cmd-1", result: null })).toBe("cmd-1");
		expect(hostedActionCommandRequestId({ commandRequestId: null, result: JSON.stringify({ commandRequestId: "cmd-2" }) })).toBe("cmd-2");
		expect(hostedActionCommandRequestId({ commandRequestId: null, result: "garbage" })).toBeNull();
	});
});
