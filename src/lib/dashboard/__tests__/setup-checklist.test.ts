import { describe, expect, it } from "vitest";
import { buildSetupChecklist, countPendingSetupItems } from "../setup-checklist";

describe("buildSetupChecklist", () => {
	it("marks every item pending on a blank install", () => {
		const items = buildSetupChecklist({
			serverCount: 0,
			enabledAlertRuleCount: 0,
			smtpEnabled: false,
			backupScheduleCount: 0,
			serversWithMonthlyCost: 0,
		});
		expect(items.every((i) => !i.done)).toBe(true);
		expect(countPendingSetupItems(items)).toBe(5);
		expect(items.map((i) => i.href)).toEqual([
			"/servers",
			"/alert-rules",
			"/settings",
			"/backups",
			"/servers",
		]);
	});

	it("marks completed items once data exists", () => {
		const items = buildSetupChecklist({
			serverCount: 2,
			enabledAlertRuleCount: 3,
			smtpEnabled: true,
			backupScheduleCount: 1,
			serversWithMonthlyCost: 1,
		});
		expect(items.every((i) => i.done)).toBe(true);
		expect(countPendingSetupItems(items)).toBe(0);
	});

	it("keeps cost monthly pending until a positive monthly cost is set", () => {
		const items = buildSetupChecklist({
			serverCount: 1,
			enabledAlertRuleCount: 1,
			smtpEnabled: true,
			backupScheduleCount: 1,
			serversWithMonthlyCost: 0,
		});
		const cost = items.find((i) => i.id === "costMonthly");
		expect(cost?.done).toBe(false);
		expect(countPendingSetupItems(items)).toBe(1);
	});
});
