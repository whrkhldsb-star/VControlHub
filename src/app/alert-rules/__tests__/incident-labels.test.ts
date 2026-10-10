import { describe, expect, it } from "vitest";

import { zh } from "@/lib/i18n/dictionaries/alert-rules-page";
import { incidentDetail, incidentTitle } from "../alert-incidents-section";
import type { AlertIncident } from "../alert-rule-types";

const t = (key: string, vars?: Record<string, string | number>) =>
	(zh[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));

const incident = {
	id: "i1", ruleId: "r1", ruleName: "CPU 过高", serverName: "hk-db-01", metric: "cpu_usage", status: "OPEN", level: 1,
	title: "Alert: hk-db-01 cpu usage", message: "CPU 过高: cpu_usage > 80 (current: 91.25)", value: 91.25, threshold: 80, operator: ">",
	acknowledgedAt: null, acknowledgedBy: null, escalatedAt: null, createdAt: "2026-10-10T00:00:00.000Z",
} satisfies AlertIncident;

describe("alert incident labels", () => {
	it("rebuilds the stored English title and message in the viewer's language", () => {
		expect(incidentTitle(incident, t)).toBe("hk-db-01 · CPU 使用率");
		expect(incidentDetail(incident, t)).toBe("CPU 过高：当前 91.3，触发条件 > 80");
		expect(incidentDetail({ ...incident, metric: "server_offline" }, t)).toBe("CPU 过高：节点离线");
	});

	it("keeps the stored text for metrics it cannot name", () => {
		const custom = { ...incident, metric: "custom_metric" };
		expect(incidentTitle(custom, t)).toBe(custom.title);
		expect(incidentDetail(custom, t)).toBe(custom.message);
	});
});
