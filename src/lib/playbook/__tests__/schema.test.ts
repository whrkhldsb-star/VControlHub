import { describe, expect, it } from "vitest";

import {
	createPlaybookSchema,
	idQuerySchema,
	updatePlaybookSchema,
} from "../schema";

function buildBaseStep() {
	return {
		id: "step-1",
		name: "step one",
		type: "run_command" as const,
		config: { command: "echo hi", serverIds: ["srv1"] },
		retry: 0,
		timeoutSec: 60,
	};
}

describe("playbook createPlaybookSchema", () => {
	it("accepts a cron-trigger playbook with a run_command step", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Cleanup",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps: [buildBaseStep()],
		});
		expect(parsed.success).toBe(true);
	});

	it("accepts a metric-trigger playbook with a send_notification step", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "CPU alarm",
			triggerType: "metric",
			triggerConfig: { metric: "cpu_usage", operator: "gt", threshold: 80 },
			steps: [
				{
					id: "s1",
					name: "notify",
					type: "send_notification",
					config: { recipientUserId: "u1", subject: "hi", body: "boom" },
					retry: 0,
					timeoutSec: 60,
				},
			],
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects when triggerType=cron but triggerConfig is metric-shaped", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Mismatch",
			triggerType: "cron",
			triggerConfig: { metric: "cpu_usage", operator: "gt", threshold: 80 },
			steps: [buildBaseStep()],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects when triggerType=metric but triggerConfig is cron-shaped", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Mismatch",
			triggerType: "metric",
			triggerConfig: { expression: "0 * * * *" },
			steps: [buildBaseStep()],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects a run_command step with empty serverIds (targets required at write-time)", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Dry plan",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps: [
				{
					id: "s1",
					name: "noop",
					type: "run_command",
					config: { command: "echo", serverIds: [] },
					retry: 0,
					timeoutSec: 60,
				},
			],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects when run_command has more than 64 serverIds", () => {
		const ids = Array.from({ length: 65 }, (_, i) => `srv${i}`);
		const parsed = createPlaybookSchema.safeParse({
			name: "Too many",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps: [
				{
					id: "s1",
					name: "x",
					type: "run_command",
					config: { command: "echo", serverIds: ids },
					retry: 0,
					timeoutSec: 60,
				},
			],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects call_webhook with a non-http(s) URL", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Bad webhook",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps: [
				{
					id: "s1",
					name: "hook",
					type: "call_webhook",
					config: { url: "ftp://nope", method: "POST" },
					retry: 0,
					timeoutSec: 60,
				},
			],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects when steps array has zero items", () => {
		const parsed = createPlaybookSchema.safeParse({
			name: "Empty",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps: [],
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects when steps array has more than 32 items", () => {
		const steps = Array.from({ length: 33 }, (_, i) => ({
			...buildBaseStep(),
			id: `step-${i}`,
		}));
		const parsed = createPlaybookSchema.safeParse({
			name: "Too many",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps,
		});
		expect(parsed.success).toBe(false);
	});

	it("accepts exactly 32 steps (boundary)", () => {
		const steps = Array.from({ length: 32 }, (_, i) => ({
			...buildBaseStep(),
			id: `step-${i}`,
		}));
		const parsed = createPlaybookSchema.safeParse({
			name: "Boundary",
			triggerType: "cron",
			triggerConfig: { expression: "0 3 * * *" },
			steps,
		});
		expect(parsed.success).toBe(true);
	});

	it("updatePlaybookSchema allows partial updates", () => {
		const parsed = updatePlaybookSchema.safeParse({ id: "pb1", name: "New name" });
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.name).toBe("New name");
			expect(parsed.data.triggerType).toBeUndefined();
		}
	});

	it("idQuerySchema requires non-empty id", () => {
		expect(idQuerySchema.safeParse({ id: "" }).success).toBe(false);
		expect(idQuerySchema.safeParse({ id: "pb1" }).success).toBe(true);
	});
});
