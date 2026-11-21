// @vitest-environment node
/**
 * The dashboard's grouped reads against a real, isolated PostgreSQL
 * (RUN_DATABASE_INTEGRATION_TESTS=1, loopback host, database name containing audit/test/_ci).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";

import { dailyAuditActivity, hourlyServerUsage } from "../analytics-queries";
import { failedTaskSummary, openIncidentSummary } from "../attention-queries";
import { downloadSummary } from "../download-summary";

const RUN = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";
const HOUR = 3_600_000;

describe.skipIf(!RUN)("dashboard analytics, grouped in PostgreSQL", () => {
	const prefix = `dash-${randomUUID().slice(0, 8)}`;
	const team = `${prefix}-team`;
	const otherTeam = `${prefix}-other`;
	const owner = `${prefix}-viewer`;
	const session = { userId: owner, roles: [], currentTeamId: team };
	const server = (name: string) => `${prefix}-${name}`;
	// Fixed instants inside the last day, on the hour grid: 3 h ago and 2 h ago.
	const hourA = new Date(Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR);
	const hourB = new Date(hourA.getTime() + HOUR);
	const since = new Date(hourA.getTime() - HOUR);
	const at = (hour: Date, minutes: number) => new Date(hour.getTime() + minutes * 60_000);

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The dashboard analytics integration test requires an isolated database");
		}
		await prisma.team.createMany({ data: [team, otherTeam].map((id) => ({ id, name: id, slug: id })) });
		await prisma.user.create({ data: { id: owner, username: owner, passwordHash: "unused" } });
		await prisma.server.createMany({
			data: [
				{ id: server("a"), teamId: team },
				{ id: server("b"), teamId: team },
				{ id: server("restricted"), teamId: team },
				{ id: server("x"), teamId: otherTeam },
			].map((row) => ({ name: row.id, host: "127.0.0.1", port: 1, username: "root", tags: [], ...row })),
		});
		const sample = (serverId: string, createdAt: Date, cpu: number | null, mem: number | null, disk: number | null, isOnline = true) =>
			({ serverId, createdAt, cpuUsage: cpu, memUsage: mem, diskUsage: disk, isOnline });
		await prisma.metricSnapshot.createMany({
			data: [
				sample(server("a"), at(hourA, 5), 10, 20, 30),
				sample(server("a"), at(hourA, 35), 30, 40, 50),
				sample(server("b"), at(hourA, 59), 80, 90, 70),
				// Not measurements: an offline sample's zeros, a server with no metrics channel.
				sample(server("a"), at(hourA, 40), 0, 0, 0, false),
				sample(server("b"), at(hourA, 41), null, null, null),
				sample(server("b"), at(hourB, 0), 51, 49, 0.4),
				// Another customer's server, and a sample before the window.
				sample(server("x"), at(hourA, 10), 100, 100, 100),
				sample(server("a"), new Date(since.getTime() - 60_000), 99, 99, 99),
			],
		});
	});

	afterAll(async () => {
		await prisma.job.deleteMany({ where: { teamId: { in: [team, otherTeam] } } });
		await prisma.alertRule.deleteMany({ where: { teamId: { in: [team, otherTeam] } } });
		await prisma.storageNode.deleteMany({ where: { teamId: { in: [team, otherTeam] } } });
		await prisma.user.deleteMany({ where: { id: owner } });
		await prisma.auditLog.deleteMany({ where: { action: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.team.deleteMany({ where: { id: { in: [team, otherTeam] } } });
		await prisma.$disconnect();
	});

	it("counts all failures in the update window and returns the most recent in the caller's scope", async () => {
		const now = new Date();
		const dayAgo = new Date(now.getTime() - 24 * HOUR);
		const older = new Date(dayAgo.getTime() - 1);
		const job = { type: "test.failure", title: "batch", payload: {}, status: "FAILED" as const, teamId: team, createdBy: owner };
		await prisma.job.createMany({ data: [
			...Array.from({ length: 52 }, () => ({ ...job, createdAt: dayAgo, updatedAt: dayAgo })),
			{ ...job, title: "long-running job", createdAt: older, updatedAt: now },
			{ ...job, createdAt: older, updatedAt: older },
			{ ...job, createdBy: null, updatedAt: now },
			{ ...job, teamId: otherTeam, updatedAt: now },
			{ ...job, status: "COMPLETED", updatedAt: now },
		] });
		expect(await failedTaskSummary(session, now)).toMatchObject({
			count: 53, latest: { title: "long-running job", source: "job", taskType: job.type, updatedAt: now },
		});
		expect((await failedTaskSummary({ ...session, roles: ["admin"] }, now)).count).toBe(54);
	});

	it("counts over 500 open incidents while excluding inaccessible servers, other customers and resolved rows", async () => {
		const rule = await prisma.alertRule.create({ data: { name: prefix, teamId: team, metric: "cpu_usage", operator: "gt", threshold: 90, serverIds: [], notifyChannels: [] } });
		const other = await prisma.alertRule.create({ data: { name: prefix, teamId: otherTeam, metric: "cpu_usage", operator: "gt", threshold: 90, serverIds: [], notifyChannels: [] } });
		await prisma.userServerAccess.create({ data: { userId: owner, serverId: server("b"), canRead: false } });
		const row = (n: number) => ({
			ruleId: rule.id, serverId: server("a"), serverName: "visible", metric: rule.metric, operator: rule.operator,
			threshold: 90, value: 99, title: `incident ${n}`, message: "high cpu", fingerprint: `${prefix}-${n}`, createdAt: hourA,
		});
		await prisma.alertIncident.createMany({ data: [
			...Array.from({ length: 501 }, (_, n) => row(n)), { ...row(501), createdAt: hourB },
			{ ...row(502), serverId: server("b") }, { ...row(503), ruleId: other.id },
			{ ...row(504), status: "RESOLVED" },
		] });
		expect(await openIncidentSummary(session)).toMatchObject({ count: 502, latest: { title: "incident 501", serverName: "visible" } });
	});

	it("returns empty incident and failed-task summaries for a teamless reader", async () => {
		const teamless = { ...session, currentTeamId: null };
		expect(await openIncidentSummary(teamless)).toEqual({ count: 0, latest: undefined });
		expect(await failedTaskSummary(teamless, new Date())).toEqual({ count: 0, latest: undefined });
	});

	it("averages the measured samples of the given servers per UTC hour, oldest first", async () => {
		expect(await hourlyServerUsage(since, [server("a"), server("b")])).toEqual([
			{ time: hourA.toISOString(), cpu: 40, memory: 50, disk: 50 },
			{ time: hourB.toISOString(), cpu: 51, memory: 49, disk: 0 },
		]);
	});

	it("projects only downloads on readable servers and paths into both the home totals and the daily chart", async () => {
		const account = { ...session, username: owner, mustChangePassword: false, permissions: ["storage:read" as const] };
		for (const name of ["a", "restricted", "x"]) {
			const drive = await prisma.storageNode.create({ data: {
				name, driver: "SFTP", basePath: "/data", serverId: server(name), teamId: name === "x" ? otherTeam : team,
			} });
			await prisma.userStorageAccess.create({ data: { userId: owner, storageNodeId: drive.id, pathPrefix: "shared", canRead: true } });
		}
		await prisma.userServerAccess.create({ data: { userId: owner, serverId: server("restricted"), canRead: false } });
		const task = { url: "https://example.test/file", targetPath: "/data/shared", status: "COMPLETED" as const, serverId: server("a"), teamId: team, createdAt: hourA };
		await prisma.downloadTask.createMany({ data: [
			task, { ...task, status: "PENDING", createdAt: new Date(0) },
			{ ...task, status: "FAILED", targetPath: "/data/private" },
			{ ...task, status: "RUNNING", serverId: server("restricted") },
			{ ...task, status: "FAILED", serverId: server("x"), teamId: otherTeam },
		] });
		expect((await downloadSummary(account)).totals).toEqual({ COMPLETED: 1, PENDING: 1 });
		expect(await downloadSummary(account, since)).toEqual({
			totals: { COMPLETED: 1 }, days: [{ date: appTimeZoneDateKey(hourA), completed: 1, failed: 0, pending: 0, running: 0 }],
		});
	});

	it("reads one customer's servers apart from another's, and nothing for no servers", async () => {
		expect(await hourlyServerUsage(since, [server("x")])).toEqual([{ time: hourA.toISOString(), cpu: 100, memory: 100, disk: 100 }]);
		expect(await hourlyServerUsage(since, [])).toEqual([]);
	});

	it("includes every server when none are named (an administrator viewing all customers)", async () => {
		const all = await hourlyServerUsage(since, null);
		// Other suites' rows may share the database: the hour of this suite's samples is at least there.
		const row = all.find((entry) => entry.time === hourB.toISOString());
		expect(row).toBeDefined();
		expect(all.map((entry) => entry.time)).toEqual([...all.map((entry) => entry.time)].sort());
	});

	it("counts audit rows per application-time day and action, for one customer or all", async () => {
		const login = `${prefix}.login`;
		const logout = `${prefix}.logout`;
		// 15:00 and 17:00 UTC straddle midnight in Asia/Shanghai (the default application time zone).
		const evening = new Date("2026-08-01T15:00:00.000Z");
		const afterMidnight = new Date("2026-08-01T17:00:00.000Z");
		const row = (action: string, createdAt: Date, teamId: string | null) => ({ actorType: "SYSTEM" as const, action, createdAt, teamId, detail: {} });
		await prisma.auditLog.createMany({
			data: [
				row(login, evening, team),
				row(login, evening, team),
				row(logout, evening, team),
				row(login, afterMidnight, team),
				row(login, afterMidnight, otherTeam),
				row(login, afterMidnight, null),
				// Before the window.
				row(login, new Date("2026-07-01T00:00:00.000Z"), team),
			],
		});
		const windowStart = new Date("2026-07-20T00:00:00.000Z");
		const now = new Date("2026-08-02T03:00:00.000Z");
		const mine = (days: Awaited<ReturnType<typeof dailyAuditActivity>>) =>
			days.map((day) => ({ date: day.date, actions: Object.fromEntries(Object.entries(day.actions).filter(([action]) => action.startsWith(prefix))) }))
				.filter((day) => Object.keys(day.actions).length > 0);

		const scoped = await dailyAuditActivity(windowStart, team, now);
		expect(scoped).toEqual([
			{ date: appTimeZoneDateKey(evening), total: 3, actions: { [login]: 2, [logout]: 1 } },
			{ date: appTimeZoneDateKey(afterMidnight), total: 1, actions: { [login]: 1 } },
		]);
		expect(appTimeZoneDateKey(evening)).not.toBe(appTimeZoneDateKey(afterMidnight));

		expect(mine(await dailyAuditActivity(windowStart, null, now))).toEqual([
			{ date: appTimeZoneDateKey(evening), actions: { [login]: 2, [logout]: 1 } },
			{ date: appTimeZoneDateKey(afterMidnight), actions: { [login]: 3 } },
		]);
	});
});
