import { describe, expect, it } from "vitest";

import { attentionTone, buildAttentionChecks, countAttention, FAILED_TASK_WINDOW_MS } from "../attention";

const now = new Date("2026-11-13T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("buildAttentionChecks", () => {
	it("has one row per check the account can see, in a fixed order, found or not", () => {
		const checks = buildAttentionChecks({ openIncidents: [], failedTasks: [], pendingApprovals: [], now });
		expect(checks.map((check) => [check.kind, check.count, check.latest])).toEqual([
			["alerts", 0, null],
			["failedTasks", 0, null],
			["approvals", 0, null],
		]);
		expect(countAttention(checks)).toBe(0);
		expect(attentionTone(checks)).toBeNull();
	});

	it("leaves out what the account cannot see, rather than reporting it as clear", () => {
		// A clear row would say "no alert is waiting" to an account that cannot know.
		const checks = buildAttentionChecks({ openIncidents: null, failedTasks: [], pendingApprovals: null, now });
		expect(checks.map((check) => check.kind)).toEqual(["failedTasks"]);
		expect(buildAttentionChecks({ openIncidents: null, failedTasks: null, pendingApprovals: null, now })).toEqual([]);
	});

	it("counts open incidents and names the newest, which the caller passes first", () => {
		const checks = buildAttentionChecks({
			openIncidents: [{ title: "web-01 CPU 使用率 ≥ 90%" }, { title: "db-02 离线" }],
			failedTasks: null,
			pendingApprovals: null,
			now,
		});
		expect(checks[0]).toEqual({ kind: "alerts", count: 2, latest: "web-01 CPU 使用率 ≥ 90%", href: "/alert-rules#incidents", tone: "danger" });
	});

	it("counts the tasks that failed in the last day only, and names the newest of them", () => {
		const checks = buildAttentionChecks({
			openIncidents: null,
			failedTasks: [
				{ title: "备份 db-02", updatedAt: ago(2 * 60 * 60 * 1000) },
				{ title: "last week's sync", updatedAt: ago(7 * FAILED_TASK_WINDOW_MS) },
				{ title: "部署 nginx", updatedAt: ago(10 * 60 * 1000) },
				{ title: "just inside the day", updatedAt: new Date(now.getTime() - FAILED_TASK_WINDOW_MS) },
			],
			pendingApprovals: null,
			now,
		});
		expect(checks[0]).toMatchObject({ kind: "failedTasks", count: 3, latest: "部署 nginx", href: "/operation-tasks?status=failed" });
	});

	it("takes the worst tone found: a failure outweighs a wait", () => {
		const waiting = buildAttentionChecks({ openIncidents: [], failedTasks: [], pendingApprovals: [{ title: "重启 nginx" }], now });
		expect(countAttention(waiting)).toBe(1);
		expect(attentionTone(waiting)).toBe("warning");
		const both = buildAttentionChecks({ openIncidents: [{ title: "db-02 离线" }], failedTasks: [], pendingApprovals: [{ title: "重启 nginx" }], now });
		expect(countAttention(both)).toBe(2);
		expect(attentionTone(both)).toBe("danger");
	});
});
