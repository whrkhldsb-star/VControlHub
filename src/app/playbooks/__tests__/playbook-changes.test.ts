import { describe, expect, it } from "vitest";

import { changedPlaybookFields, type PlaybookFields, type SerializedPlaybook } from "../playbook-types";

const step = (id: string, command: string) => ({ id, name: `step ${id}`, type: "run_command" as const, config: { command, serverIds: ["srv1"] }, retry: 0, timeoutSec: 60 });

const saved: SerializedPlaybook = {
	id: "pb_1",
	name: "Nightly",
	description: null,
	triggerType: "cron",
	triggerConfig: { expression: "0 3 * * *" },
	steps: [step("a", "echo a"), step("b", "echo b")],
	chainRetry: 0,
	enabled: true,
	nextRunAt: null,
	lastTriggeredAt: null,
	ownerActive: true,
	createdAt: "2026-01-01T00:00:00.000Z",
};

/** The form's values for the saved playbook, as it opens. */
const unchanged = (): PlaybookFields => ({
	name: saved.name,
	description: null,
	triggerType: saved.triggerType,
	triggerConfig: { expression: "0 3 * * *" },
	steps: saved.steps.map((s) => ({ ...s, config: { ...s.config } })),
	chainRetry: 0,
	enabled: true,
});

describe("changedPlaybookFields", () => {
	it("finds nothing to send when nothing changed", () => {
		expect(changedPlaybookFields(saved, unchanged())).toEqual({});
		// An empty description and none are the same.
		expect(changedPlaybookFields(saved, { ...unchanged(), description: "" })).toEqual({});
	});

	// Re-sending the trigger, the switch or the retries takes playbook:run and resets a metric trigger's state.
	it("sends a renamed playbook's name and nothing else", () => {
		expect(changedPlaybookFields(saved, { ...unchanged(), name: "Nightly (new)" })).toEqual({ name: "Nightly (new)" });
	});

	it("sends the trigger, whole, when its type or a setting changed", () => {
		expect(changedPlaybookFields(saved, { ...unchanged(), triggerConfig: { expression: "0 4 * * *" } }))
			.toEqual({ triggerType: "cron", triggerConfig: { expression: "0 4 * * *" } });
		const metric = { metric: "cpu_usage", operator: "gt", threshold: 80 };
		expect(changedPlaybookFields(saved, { ...unchanged(), triggerType: "metric", triggerConfig: metric }))
			.toEqual({ triggerType: "metric", triggerConfig: metric });
		const savedMetric = { ...saved, triggerType: "metric" as const, triggerConfig: metric };
		expect(changedPlaybookFields(savedMetric, { ...unchanged(), triggerType: "metric", triggerConfig: { ...metric } })).toEqual({});
		expect(changedPlaybookFields(savedMetric, { ...unchanged(), triggerType: "metric", triggerConfig: { ...metric, threshold: 90 } }))
			.toEqual({ triggerType: "metric", triggerConfig: { ...metric, threshold: 90 } });
	});

	it("sends every step when one changed or they were reordered", () => {
		const edited = { ...unchanged(), steps: [step("a", "echo a"), step("b", "echo B")] };
		expect(changedPlaybookFields(saved, edited).steps?.map((s) => s.config.command)).toEqual(["echo a", "echo B"]);
		const reordered = { ...unchanged(), steps: [...unchanged().steps].reverse() };
		expect(changedPlaybookFields(saved, reordered).steps?.map((s) => s.id)).toEqual(["b", "a"]);
	});

	it("sends a cleared description as none, and the switch and retries when changed", () => {
		const described = { ...saved, description: "Rotates the logs" };
		expect(changedPlaybookFields(described, { ...unchanged(), description: "" })).toEqual({ description: null });
		expect(changedPlaybookFields(saved, { ...unchanged(), enabled: false, chainRetry: 2 })).toEqual({ enabled: false, chainRetry: 2 });
	});
});
