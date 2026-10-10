import { describe, expect, it } from "vitest";
import { browserT } from "@/lib/i18n/browser-translations";
import { localizeNotification, renderNotificationFallback } from "../message";

const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);

describe("notification messages", () => {
	it("renders the stored fallback in Chinese and the viewer's language on display", () => {
		const notice = { code: "commandApproved", params: { title: "Restart nginx" } } as const;
		const fallback = renderNotificationFallback(notice);
		expect(fallback).toEqual({ title: "命令已批准", message: "命令「Restart nginx」已批准，即将执行。" });
		const row = { ...fallback, messageCode: notice.code, messageParams: notice.params };
		expect(localizeNotification(row, en)).toEqual({
			title: "Command approved",
			message: "Command \"Restart nginx\" has been approved and will execute shortly.",
		});
	});

	it("translates params passed as translation keys", () => {
		const row = {
			title: "", message: "", messageCode: "alertFired",
			messageParams: { server: "web-1", rule: "CPU", metricKey: "alertRulesPage.createForm.metric.cpu_usage", operatorKey: "alertRulesPage.createForm.operator.gt", threshold: 80, value: "91.5" },
		};
		expect(localizeNotification(row, en)).toEqual({ title: "Alert: web-1 · CPU Usage", message: "CPU: now 91.5, fires when Greater than 80" });
	});

	it("keeps the stored text for free-text rows, unknown codes and unknown param keys", () => {
		const stored = { title: "Backup done", message: "Nightly backup finished" };
		expect(localizeNotification(stored, en)).toEqual(stored);
		expect(localizeNotification({ ...stored, messageCode: "removedCode" }, en)).toEqual(stored);
		expect(localizeNotification({ ...stored, messageCode: "alertResolved", messageParams: { server: "a", rule: "b", metricKey: "missing.key" } }, en)).toEqual(stored);
	});

	it("keeps the stored message when the code only localizes the title", () => {
		const row = { title: "x", message: "Login: admin / secret", messageCode: "quickServiceInstalled", messageParams: { name: "Gitea" } };
		expect(localizeNotification(row, en)).toEqual({ title: "Quick service installed: Gitea", message: "Login: admin / secret" });
	});
});
