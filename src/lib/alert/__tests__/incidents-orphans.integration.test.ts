// @vitest-environment node
/**
 * Incidents that no evaluation can reach any more, against a real, isolated
 * PostgreSQL (RUN_DATABASE_INTEGRATION_TESTS=1, loopback host, database name
 * containing audit/test/_ci).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

const { buildAlertFingerprint, resolveOrphanedAlertIncidents } = await import("../incidents");

const RUN = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN)("alert incidents left behind by a changed rule (PostgreSQL)", () => {
	const prefix = `orphan-${randomUUID().slice(0, 8)}`;
	const team = `${prefix}-team`;
	const otherTeam = `${prefix}-other`;
	const server = (name: string) => `${prefix}-${name}`;
	const rule = (name: string) => `${prefix}-rule-${name}`;

	const incident = (ruleId: string, serverId: string, metric: string, id?: string) => ({
		...(id ? { id } : {}),
		fingerprint: buildAlertFingerprint(ruleId, serverId, metric),
		ruleId,
		serverId,
		serverName: serverId,
		metric,
		operator: "gte",
		threshold: 90,
		value: 95,
		title: "t",
		message: "m",
		pendingNotifyChannels: ["webhook"],
		nextNotifyAt: new Date(Date.now() + 60_000),
	});
	const statusOf = async (ruleId: string, serverId: string, metric: string) =>
		(await prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint: buildAlertFingerprint(ruleId, serverId, metric) } })).status;

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The alert orphan integration test requires an isolated database");
		}
		await prisma.team.createMany({ data: [team, otherTeam].map((id) => ({ id, name: id, slug: id })) });
		await prisma.server.createMany({
			data: [
				{ id: server("a"), teamId: team },
				{ id: server("b"), teamId: team },
				{ id: server("moved"), teamId: otherTeam },
				{ id: server("off"), teamId: team, enabled: false },
			].map((row) => ({ name: row.id, host: "127.0.0.1", port: 1, username: "root", tags: [], ...row })),
		});
		const base = { operator: "gte", threshold: 90, notifyChannels: ["in_app"], teamId: team };
		await prisma.alertRule.createMany({
			data: [
				{ id: rule("live"), name: "live", metric: "cpu_usage", serverIds: [], ...base },
				{ id: rule("disabled"), name: "disabled", metric: "cpu_usage", serverIds: [], enabled: false, ...base },
				// Was a CPU rule when its incident opened.
				{ id: rule("metric"), name: "metric", metric: "mem_usage", serverIds: [], ...base },
				// Watched servers a and b when its incidents opened.
				{ id: rule("scoped"), name: "scoped", metric: "cpu_usage", serverIds: [server("a")], ...base },
				{ id: rule("paged"), name: "paged", metric: "cpu_usage", serverIds: [], ...base },
			],
		});
	});

	afterAll(async () => {
		await prisma.alertRule.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.team.deleteMany({ where: { id: { in: [team, otherTeam] } } });
		await prisma.$disconnect();
	});

	it("closes what the rule no longer watches and keeps what it still does", async () => {
		await prisma.alertIncident.createMany({
			data: [
				incident(rule("live"), server("a"), "cpu_usage"),
				incident(rule("live"), server("moved"), "cpu_usage"),
				incident(rule("disabled"), server("a"), "cpu_usage"),
				incident(rule("metric"), server("a"), "cpu_usage"),
				incident(rule("scoped"), server("a"), "cpu_usage"),
				incident(rule("scoped"), server("b"), "cpu_usage"),
			],
		});

		const result = await resolveOrphanedAlertIncidents({ ruleTeamWhere: { id: { startsWith: `${prefix}-rule-` }, NOT: { id: rule("paged") } } });

		expect(result.resolved).toBe(4);
		// Still evaluated: the rule is on, watches this metric and this server.
		expect(await statusOf(rule("live"), server("a"), "cpu_usage")).toBe("OPEN");
		expect(await statusOf(rule("scoped"), server("a"), "cpu_usage")).toBe("OPEN");
		// A disabled rule is never evaluated: its incident could not recover, be escalated or be closed by hand.
		expect(await statusOf(rule("disabled"), server("a"), "cpu_usage")).toBe("RESOLVED");
		// The rule watches another metric now: nothing produces this fingerprint again.
		expect(await statusOf(rule("metric"), server("a"), "cpu_usage")).toBe("RESOLVED");
		// The server was taken off the rule's list, or moved to another customer.
		expect(await statusOf(rule("scoped"), server("b"), "cpu_usage")).toBe("RESOLVED");
		expect(await statusOf(rule("live"), server("moved"), "cpu_usage")).toBe("RESOLVED");
		// A closed incident has no notice left to retry.
		const closed = await prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint: buildAlertFingerprint(rule("disabled"), server("a"), "cpu_usage") } });
		expect(closed).toMatchObject({ pendingNotifyChannels: [], nextNotifyAt: null });
		expect(closed.resolvedAt).toBeInstanceOf(Date);
	});

	it("reaches the incidents after the first page when that page ended on one it closed", async () => {
		// 500 per page. Resuming from a row that had just left the filter skipped the row after it.
		const id = (n: number) => `${prefix}-inc-${String(n).padStart(4, "0")}`;
		// One incident per (rule, server, metric): the metric name only has to differ.
		await prisma.alertIncident.createMany({
			data: Array.from({ length: 503 }, (_, index) => {
				const n = index + 1;
				const orphan = n >= 500;
				return { ...incident(rule("paged"), server(orphan ? "off" : "a"), "cpu_usage", id(n)), fingerprint: `${prefix}:paged:${n}` };
			}),
		});

		const result = await resolveOrphanedAlertIncidents({ ruleTeamWhere: { id: rule("paged") } });

		expect(result.resolved).toBe(4);
		const left = await prisma.alertIncident.findMany({ where: { ruleId: rule("paged"), serverId: server("off"), status: { not: "RESOLVED" } }, select: { id: true } });
		expect(left).toEqual([]);
		expect(await prisma.alertIncident.count({ where: { ruleId: rule("paged"), status: "OPEN" } })).toBe(499);
	});
});
