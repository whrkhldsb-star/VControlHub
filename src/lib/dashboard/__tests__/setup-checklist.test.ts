import { describe, expect, it } from "vitest";
import { buildSetupChecklist, countPendingSetupItems, filterSetupChecklist } from "../setup-checklist";

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
			"/settings#smtp",
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

	it("shows an account only the items it may complete", () => {
		const items = buildSetupChecklist({
			serverCount: 0,
			enabledAlertRuleCount: 0,
			smtpEnabled: false,
			backupScheduleCount: 0,
			serversWithMonthlyCost: 0,
		});
		const operator = new Set(["server:write", "notification:manage"]);
		expect(filterSetupChecklist(items, (permission) => operator.has(permission)).map((i) => i.id)).toEqual([
			"servers",
			"alertRules",
			"costMonthly",
		]);
		expect(filterSetupChecklist(items, () => false)).toEqual([]);
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

	it("counts Telegram as an outbound notification channel as well as SMTP", () => {
		const base = { serverCount: 1, enabledAlertRuleCount: 1, smtpEnabled: false, backupScheduleCount: 1, serversWithMonthlyCost: 1 };
		const outbound = (input: Parameters<typeof buildSetupChecklist>[0]) => buildSetupChecklist(input).find((item) => item.id === "notificationOutbound");
		expect(outbound(base)?.done).toBe(false);
		expect(outbound({ ...base, telegramEnabled: true })?.done).toBe(true);
		expect(outbound({ ...base, smtpEnabled: true })?.done).toBe(true);
	});
});
