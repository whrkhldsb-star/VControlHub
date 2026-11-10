import { describe, expect, it } from "vitest";

import { repairSuggestions } from "../health-dashboard-helpers";
import type { SystemHealthCheck, SystemHealthReport } from "../health-types";

const t = (key: string) => key;

function report(checks: Array<Pick<SystemHealthCheck, "id" | "status">>): SystemHealthReport {
	const full = checks.map((check) => ({ ...check, label: check.id, message: "" }));
	const count = (status: string) => full.filter((check) => check.status === status).length;
	return {
		generatedAt: "2026-10-10T00:00:00.000Z",
		summary: { total: full.length, healthy: count("healthy"), warning: count("warning"), critical: count("critical"), overall: "healthy" },
		checks: full,
	};
}

describe("repairSuggestions", () => {
	it("offers nothing when every check passes", () => {
		expect(repairSuggestions(report([{ id: "database", status: "healthy" }, { id: "dir-logs", status: "healthy" }]), t)).toEqual([]);
	});

	it("only advises on the checks that fail, not on unrelated ones", () => {
		const advice = repairSuggestions(report([
			{ id: "database", status: "healthy" },
			{ id: "dir-logs", status: "healthy" },
			{ id: "runtime-directories", status: "healthy" },
			{ id: "notification-settings", status: "warning" },
			{ id: "git-sync", status: "warning" },
		]), t);
		expect(advice.map((item) => item.id)).toEqual(["notifications", "git"]);
		expect(advice[0]).toMatchObject({ status: "warning", href: "/settings#smtp", description: "healthPage.repair.notifications.description" });
	});

	it("lists critical advice first and takes the worst status of the covered checks", () => {
		const advice = repairSuggestions(report([
			{ id: "git-sync", status: "warning" },
			{ id: "worker-service", status: "warning" },
			{ id: "caddy-service", status: "critical" },
		]), t);
		expect(advice.map((item) => [item.id, item.status])).toEqual([["services", "critical"], ["git", "warning"]]);
	});
});

describe("the service advice", () => {
	it("names the units that are not running, as this install calls them", async () => {
		// The hint listed "vcontrolhub-…" units whatever the install's slug was.
		const { zh, en } = await import("@/lib/i18n/dictionaries/health-page");
		const translate = (dictionary: Record<string, string>) => (key: string, vars?: Record<string, string | number>) =>
			Object.entries(vars ?? {}).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), dictionary[key] ?? key);
		const failing = report([
			{ id: "next-service", status: "healthy" },
			{ id: "worker-service", status: "critical" },
			{ id: "caddy-service", status: "warning" },
		]);
		failing.checks[0]!.params = { unit: "my-console-next.service" };
		failing.checks[1]!.params = { unit: "my-console-worker.service", state: "failed" };
		failing.checks[2]!.params = { unit: "caddy.service" };
		expect(repairSuggestions(failing, translate(zh))[0]).toMatchObject({ id: "services", action: "验证 my-console-worker.service / caddy.service" });
		expect(repairSuggestions(failing, translate(en))[0]).toMatchObject({ action: "Verify my-console-worker.service / caddy.service" });
	});
});

describe("formatProjectedPercent", () => {
	it("caps projections at full instead of printing impossible usage", async () => {
		const { formatProjectedPercent } = await import("../capacity-forecast-panel");
		expect(formatProjectedPercent(79.84)).toBe("79.8%");
		expect(formatProjectedPercent(100)).toBe("≥100%");
		expect(formatProjectedPercent(150)).toBe("≥100%");
	});
});
