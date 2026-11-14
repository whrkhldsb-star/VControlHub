import { describe, expect, it } from "vitest";

import { changedTaskFields, type SavedTask, type TaskFormValues } from "../task-changes";

const saved: SavedTask = {
	name: "Clean logs",
	scheduleType: "CRON",
	cronExpression: "0 2 * * *",
	runAt: null,
	command: "journalctl --vacuum-time=7d",
	reason: "Free disk",
	plan: null,
	verificationCommand: null,
	rollbackCommand: null,
	approvalRequired: true,
	serverIds: ["srv_1", "srv_2"],
};

/** The form's values for the saved task, as it opens. */
const unchanged = (task: SavedTask = saved): TaskFormValues => ({
	name: task.name,
	scheduleType: task.scheduleType ?? "CRON",
	cronExpression: task.scheduleType === "ONCE" ? "0 3 * * *" : task.cronExpression,
	runAt: task.runAt ?? undefined,
	command: task.command,
	reason: task.reason ?? "",
	plan: task.plan ?? "",
	verificationCommand: task.verificationCommand ?? "",
	rollbackCommand: task.rollbackCommand ?? "",
	approvalRequired: task.approvalRequired ?? true,
	serverIds: [...task.serverIds],
});

describe("changedTaskFields", () => {
	it("finds nothing to send when nothing changed", () => {
		expect(changedTaskFields(saved, unchanged())).toEqual({});
		// The same servers in another order, and the expression with stray spaces, are no change.
		expect(changedTaskFields(saved, { ...unchanged(), serverIds: ["srv_2", "srv_1"], cronExpression: " 0 2 * * * " })).toEqual({});
	});

	// The server computes a re-sent schedule again and refuses a one-off time already past.
	it("renames a one-off task that has run without sending its time", () => {
		const ran: SavedTask = { ...saved, scheduleType: "ONCE", cronExpression: "0 0 1 1 *", runAt: "2026-01-01T03:00:42.000Z" };
		const form = { ...unchanged(ran), runAt: "2026-01-01T03:00:00.000Z" }; // the form keeps the minute
		expect(changedTaskFields(ran, form)).toEqual({});
		expect(changedTaskFields(ran, { ...form, name: "Clean logs once" })).toEqual({ name: "Clean logs once" });
		expect(changedTaskFields(ran, { ...form, runAt: "2027-01-01T03:00:00.000Z" })).toEqual({ scheduleType: "ONCE", runAt: "2027-01-01T03:00:00.000Z" });
	});

	it("sends the schedule when its kind or time changed", () => {
		expect(changedTaskFields(saved, { ...unchanged(), cronExpression: "0 4 * * *" })).toEqual({ scheduleType: "CRON", cronExpression: "0 4 * * *" });
		expect(changedTaskFields(saved, { ...unchanged(), scheduleType: "ONCE", runAt: "2027-01-01T03:00:00.000Z" }))
			.toEqual({ scheduleType: "ONCE", runAt: "2027-01-01T03:00:00.000Z" });
	});

	// Sending "no approval" again takes command:approve even when approval was already off.
	it("sends the approval setting only when it changed", () => {
		const unattended = { ...saved, approvalRequired: false };
		expect(changedTaskFields(unattended, { ...unchanged(unattended), name: "Renamed" })).toEqual({ name: "Renamed" });
		expect(changedTaskFields(unattended, { ...unchanged(unattended), approvalRequired: true })).toEqual({ approvalRequired: true });
	});

	it("sends an emptied field as empty, which clears it, and a picked template", () => {
		const planned = { ...saved, plan: "1. vacuum", rollbackCommand: "true" };
		expect(changedTaskFields(planned, { ...unchanged(planned), plan: "", rollbackCommand: "" })).toEqual({ plan: "", rollbackCommand: "" });
		expect(changedTaskFields(saved, { ...unchanged(), templateId: "tmpl_1", command: "docker system prune -f" }))
			.toEqual({ templateId: "tmpl_1", command: "docker system prune -f" });
		expect(changedTaskFields(saved, { ...unchanged(), serverIds: ["srv_1"] })).toEqual({ serverIds: ["srv_1"] });
	});
});
