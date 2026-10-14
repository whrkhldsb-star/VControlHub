// @vitest-environment node
/**
 * Status board against a real, isolated PostgreSQL (RUN_DATABASE_INTEGRATION_TESTS=1,
 * loopback host, database name containing audit/test/_ci). Covers the SQL the
 * unit tests cannot: the latest-metrics upsert, the visibility rule, revocation,
 * ownership changes, history bucketing, coverage and the uptime rollup.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { snapshotHealthOverview } from "@/lib/health/service-metrics";
import { rollupServerUptimeForDay } from "@/lib/uptime/rollup";
import { startOfDayInAppTimeZone, startOfMonthInAppTimeZone } from "@/lib/datetime/time-zone";
import { writeLatestMetrics, type LatestMetricInput } from "./latest-writer";
import { applyNodeBatch, updateNodePublication } from "./nodes-admin";
import { invalidatePublicStatusCache, loadVisibleNodeRows } from "./projection";
import { queryCoverage, queryNetworkBuckets, queryResourceBuckets } from "./history";
import { clearPublicHistoryCache, readPublicBoard, readPublicHistory, readPublicNode } from "./read";
import { savePublicSite } from "./site";
import { DEFAULT_BOARD_QUERY } from "./query";
import type { NormalizedMetrics } from "./normalize";

vi.mock("@/lib/storage/health", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/storage/health")>(),
	scheduleStorageNodeHealthProbe: vi.fn(),
}));

const RUN = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

function values(rx: bigint | null, tx: bigint | null, iface = "eth0"): NormalizedMetrics {
	return {
		cpuUsage: 10, cpuCores: 2, load1: 0.1, load5: 0.1, load15: 0.1, memUsage: 50, memUsedMb: 512, memTotalMb: 1024,
		swapUsage: null, diskUsage: 40, diskUsedBytes: 1e9, diskTotalBytes: 2e9, uptimeSeconds: 100, netIface: iface, netRxBytes: rx, netTxBytes: tx,
	};
}

describe.skipIf(!RUN)("public status board (PostgreSQL)", () => {
	const prefix = `ps-${randomUUID().slice(0, 8)}`;
	const teamA = `${prefix}-team-a`;
	const teamB = `${prefix}-team-b`;
	const teamGone = `${prefix}-team-gone`;
	const ids = {
		pub: `${prefix}-pub`,
		legacy: `${prefix}-legacy`,
		hidden: `${prefix}-hidden`,
		unpub: `${prefix}-unpub`,
		disabled: `${prefix}-disabled`,
		moved: `${prefix}-moved`,
		goneTeam: `${prefix}-gone`,
		metrics: `${prefix}-metrics`,
	};
	const all = Object.values(ids);
	const publicIdOf = new Map<string, string>();

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The status board integration test requires an isolated database");
		}
		await prisma.team.createMany({ data: [
			{ id: teamA, name: `${prefix} A`, slug: `${prefix}-a` },
			{ id: teamB, name: `${prefix} B`, slug: `${prefix}-b` },
			{ id: teamGone, name: `${prefix} gone`, slug: `${prefix}-gone` },
		] });
		await prisma.server.createMany({ data: [
			{ id: ids.pub, name: "internal-pub", host: "203.0.113.10", username: "root", teamId: teamA },
			{ id: ids.legacy, name: "internal-legacy", host: "203.0.113.11", username: "root" },
			{ id: ids.hidden, name: "internal-hidden", host: "203.0.113.12", username: "root", teamId: teamA },
			{ id: ids.unpub, name: "internal-unpub", host: "203.0.113.13", username: "root", teamId: teamA },
			{ id: ids.disabled, name: "internal-disabled", host: "203.0.113.14", username: "root", teamId: teamA },
			{ id: ids.moved, name: "internal-moved", host: "203.0.113.15", username: "root", teamId: teamA },
			{ id: ids.goneTeam, name: "internal-gone", host: "203.0.113.16", username: "root", teamId: teamGone },
			{ id: ids.metrics, name: "internal-metrics", host: "203.0.113.17", username: "root", teamId: teamA },
		] });
		const publish = async (serverId: string, name: string, published = true) => {
			const saved = await updateNodePublication(serverId, {
				displayName: name, groupName: "G", region: "R", tags: ["t"], sortOrder: 0, note: null, maintenance: false, published,
			}, "integration-admin");
			publicIdOf.set(serverId, saved.publicId);
		};
		await publish(ids.pub, `${prefix} public`);
		await publish(ids.legacy, `${prefix} legacy`);
		await publish(ids.unpub, `${prefix} unpublished`, false);
		await publish(ids.disabled, `${prefix} disabled`);
		await publish(ids.moved, `${prefix} moved`);
		await publish(ids.goneTeam, `${prefix} gone`);
		await publish(ids.metrics, `${prefix} metrics`);
		// Changes made after publishing, outside the board's own code paths.
		await prisma.server.update({ where: { id: ids.disabled }, data: { enabled: false } });
		await prisma.server.update({ where: { id: ids.moved }, data: { teamId: teamB } });
		await prisma.team.update({ where: { id: teamGone }, data: { deletedAt: new Date() } });
		await savePublicSite({
			enabled: true, title: null, description: null, announcement: null, defaultView: "cards", refreshSeconds: 15,
			accent: "default", metrics: ["cpu", "memory", "disk", "network", "traffic", "uptime", "load", "latency", "availability"], showPlatformStatus: false,
		}, "integration-admin");
		invalidatePublicStatusCache();
	});

	beforeEach(() => {
		invalidatePublicStatusCache();
		clearPublicHistoryCache();
	});

	afterAll(async () => {
		await prisma.server.deleteMany({ where: { id: { in: all } } });
		await prisma.team.deleteMany({ where: { id: { in: [teamA, teamB, teamGone] } } });
		await prisma.publicStatusSite.deleteMany({ where: { id: "default" } });
		await prisma.$disconnect();
	});

	it("migrations leave the board closed and nothing published by default", async () => {
		const fresh = await prisma.server.create({ data: { id: `${prefix}-fresh`, name: "fresh", host: "203.0.113.99", username: "root" } });
		try {
			expect(await prisma.publicStatusNode.findUnique({ where: { serverId: fresh.id } })).toBeNull();
			const rows = await loadVisibleNodeRows();
			expect(rows.some((row) => row.serverId === fresh.id)).toBe(false);
		} finally {
			await prisma.server.delete({ where: { id: fresh.id } });
		}
	});

	it("shows only published, enabled, same-owner, live-customer servers", async () => {
		const visible = (await loadVisibleNodeRows()).filter((row) => row.serverId.startsWith(prefix)).map((row) => row.serverId).sort();
		expect(visible).toEqual([ids.legacy, ids.metrics, ids.pub].sort());
		for (const hidden of [ids.unpub, ids.disabled, ids.moved, ids.goneTeam]) {
			expect(await readPublicNode(publicIdOf.get(hidden)!)).toBeNull();
			expect(await readPublicHistory(publicIdOf.get(hidden)!, "24h")).toBeNull();
		}
		expect(await readPublicNode("aaaaaaaaaaaa")).toBeNull();
		expect(await readPublicNode("../../etc")).toBeNull();
	});

	it("never serialises internal fields in board, detail or history", async () => {
		const board = await readPublicBoard({ ...DEFAULT_BOARD_QUERY, q: prefix, pageSize: 100 });
		const detail = await readPublicNode(publicIdOf.get(ids.pub)!);
		const history = await readPublicHistory(publicIdOf.get(ids.pub)!, "1h");
		const json = JSON.stringify([board, detail, history]);
		expect(json).not.toMatch(/203\.0\.113|internal-|root|serverId|teamId|team-a|integration-admin/);
		expect(board?.filteredTotal).toBe(3);
	});

	it("revocation removes the node from list, detail, history and totals at once", async () => {
		const publicId = publicIdOf.get(ids.metrics)!;
		expect(await readPublicNode(publicId)).not.toBeNull();
		await applyNodeBatch({ action: "unpublish", serverIds: [ids.metrics] }, "integration-admin");
		invalidatePublicStatusCache();
		clearPublicHistoryCache();
		expect(await readPublicNode(publicId)).toBeNull();
		expect(await readPublicHistory(publicId, "24h")).toBeNull();
		const board = await readPublicBoard({ ...DEFAULT_BOARD_QUERY, q: prefix, pageSize: 100 });
		expect(board?.nodes.map((node) => node.id)).not.toContain(publicId);
		await applyNodeBatch({ action: "publish", serverIds: [ids.metrics] }, "integration-admin");
	});

	it("batch publish is all-or-nothing when a node disappears part-way", async () => {
		const publicId = publicIdOf.get(ids.metrics)!;
		await applyNodeBatch({ action: "unpublish", serverIds: [ids.metrics] }, "integration-admin");
		// The node row of the second target is gone by the time it is written
		// (as when its server is deleted concurrently): a real P2025 from PostgreSQL.
		const ghost = `${prefix}-ghost`;
		const findMany = prisma.publicStatusNode.findMany.bind(prisma.publicStatusNode);
		const spy = vi.spyOn(prisma.publicStatusNode, "findMany").mockImplementationOnce(((args: Parameters<typeof findMany>[0]) =>
			findMany(args).then((rows) => [...rows, { serverId: ghost, displayName: "Ghost", server: { teamId: teamA } }])) as never);
		try {
			await expect(applyNodeBatch({ action: "publish", serverIds: [ids.metrics, ghost] }, "integration-admin")).rejects.toMatchObject({ code: "P2025" });
		} finally {
			spy.mockRestore();
		}
		const row = await prisma.publicStatusNode.findUnique({ where: { serverId: ids.metrics }, select: { published: true, publishedAt: true } });
		expect(row).toEqual({ published: false, publishedAt: null });
		invalidatePublicStatusCache();
		expect(await readPublicNode(publicId)).toBeNull();

		await expect(applyNodeBatch({ action: "publish", serverIds: [ids.metrics] }, "integration-admin")).resolves.toEqual({ changed: 1, skipped: [] });
		invalidatePublicStatusCache();
		expect(await readPublicNode(publicId)).not.toBeNull();
	});

	it("the cached board list re-checks visibility on every read (no invalidation call)", async () => {
		const query = { ...DEFAULT_BOARD_QUERY, q: prefix, pageSize: 100 };
		const visibleIds = async () => (await readPublicBoard(query))!.nodes.map((node) => node.id).sort();
		const publicId = publicIdOf.get(ids.pub)!;
		// Warm the cache.
		expect(await visibleIds()).toContain(publicId);
		const total = (await readPublicBoard(query))!.summary.total;
		const cases: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
			["server disabled", () => prisma.server.update({ where: { id: ids.pub }, data: { enabled: false } }), () => prisma.server.update({ where: { id: ids.pub }, data: { enabled: true } })],
			["moved to another customer", () => prisma.server.update({ where: { id: ids.pub }, data: { teamId: teamB } }), () => prisma.server.update({ where: { id: ids.pub }, data: { teamId: teamA } })],
			["customer deleted", () => prisma.team.update({ where: { id: teamA }, data: { deletedAt: new Date() } }), () => prisma.team.update({ where: { id: teamA }, data: { deletedAt: null } })],
			["unpublished in the database", () => prisma.publicStatusNode.update({ where: { serverId: ids.pub }, data: { published: false } }), () => prisma.publicStatusNode.update({ where: { serverId: ids.pub }, data: { published: true } })],
		];
		for (const [label, hide, restore] of cases) {
			await hide();
			try {
				const board = (await readPublicBoard(query))!;
				expect(board.nodes.map((node) => node.id), label).not.toContain(publicId);
				expect(board.summary.total, label).toBeLessThan(total);
			} finally {
				await restore();
			}
			// Visible again at once: the cache is rebuilt when a visible node is missing.
			expect(await visibleIds(), `${label} restored`).toContain(publicId);
		}
	});

	it("a later ownership change hides the node from detail reads immediately (no cache)", async () => {
		const publicId = publicIdOf.get(ids.pub)!;
		await prisma.server.update({ where: { id: ids.pub }, data: { teamId: teamB } });
		try {
			expect(await readPublicNode(publicId)).toBeNull();
		} finally {
			await prisma.server.update({ where: { id: ids.pub }, data: { teamId: teamA } });
		}
		expect(await readPublicNode(publicId)).not.toBeNull();
	});

	it("a closed board answers nothing except an administrator preview", async () => {
		// Warm the cache first: a site change must apply without any invalidation call.
		expect(await readPublicBoard(DEFAULT_BOARD_QUERY)).not.toBeNull();
		await prisma.publicStatusSite.update({ where: { id: "default" }, data: { enabled: false } });
		try {
			expect(await readPublicBoard(DEFAULT_BOARD_QUERY)).toBeNull();
			expect(await readPublicNode(publicIdOf.get(ids.pub)!)).toBeNull();
			const preview = await readPublicBoard({ ...DEFAULT_BOARD_QUERY, q: prefix }, { preview: true });
			expect(preview?.filteredTotal).toBe(3);
		} finally {
			await prisma.publicStatusSite.update({ where: { id: "default" }, data: { enabled: true } });
		}
	});

	it("a change of published categories applies to the cached list at once", async () => {
		const query = { ...DEFAULT_BOARD_QUERY, q: prefix, pageSize: 100 };
		expect((await readPublicBoard(query))?.site.metrics).toContain("cpu");
		await prisma.publicStatusSite.update({ where: { id: "default" }, data: { metrics: ["memory"] } });
		try {
			const board = await readPublicBoard(query);
			expect(board?.site.metrics).toEqual(["memory"]);
			expect(board?.nodes.every((node) => Object.keys(node.metrics).every((key) => key === "memory"))).toBe(true);
		} finally {
			await prisma.publicStatusSite.update({ where: { id: "default" }, data: { metrics: ["cpu", "memory", "disk", "network", "traffic", "uptime", "load", "latency", "availability"] } });
		}
	});

	describe("latest metric upsert", () => {
		const serverId = ids.metrics;
		const t0 = new Date("2026-10-13T00:00:00.000Z");
		const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
		const sample = (seconds: number, rx: bigint | null, tx: bigint | null, extra: Partial<LatestMetricInput> = {}, iface = "eth0"): LatestMetricInput => ({
			serverId,
			checkedAt: at(seconds),
			online: true,
			intervalSeconds: 300,
			metrics: { sampledAt: at(seconds), source: "ssh", values: values(rx, tx, iface) },
			...extra,
		});
		const read = () => prisma.serverMetricLatest.findUniqueOrThrow({ where: { serverId } });

		beforeAll(async () => {
			await prisma.serverMetricLatest.deleteMany({ where: { serverId } });
		});

		it("first sample: no rate yet, period counting starts", async () => {
			await writeLatestMetrics([sample(0, BigInt(1_000_000), BigInt(2_000_000), { probe: { at: at(0), ok: true, latencyMs: 12.5 } })]);
			const row = await read();
			expect(row.metricsAt?.toISOString()).toBe(t0.toISOString());
			expect(row.rxRateBps).toBeNull();
			expect(row.periodRxBytes).toBe(BigInt(0));
			expect(row.periodSince?.toISOString()).toBe(t0.toISOString());
			expect(row.periodStart?.toISOString()).toBe(startOfMonthInAppTimeZone(t0).toISOString());
			expect(row).toMatchObject({ probeOk: true, probeLatencyMs: 12.5, metricsSource: "ssh", online: true });
		});

		it("second sample: rate in bytes per second and the delta counted", async () => {
			await writeLatestMetrics([sample(300, BigInt(1_300_000), BigInt(2_150_000))]);
			const row = await read();
			expect(row.rxRateBps).toBe(1000);
			expect(row.txRateBps).toBe(500);
			expect(row.rateIntervalSeconds).toBe(300);
			expect(row.periodRxBytes).toBe(BigInt(300_000));
			expect(row.periodTxBytes).toBe(BigInt(150_000));
			// The probe of the first verdict is kept (no newer probe).
			expect(row.probeLatencyMs).toBe(12.5);
		});

		it("re-sending the same or an older sample changes nothing", async () => {
			await writeLatestMetrics([sample(300, BigInt(9_999_999), BigInt(9_999_999)), sample(100, BigInt(1), BigInt(1))]);
			const row = await read();
			expect(row.netRxBytes).toBe(BigInt(1_300_000));
			expect(row.periodRxBytes).toBe(BigInt(300_000));
		});

		it("a counter reset (reboot) gives no rate and counts the new counter", async () => {
			await writeLatestMetrics([sample(600, BigInt(50_000), BigInt(10_000))]);
			const row = await read();
			expect(row.rxRateBps).toBeNull();
			expect(row.txRateBps).toBeNull();
			expect(row.periodRxBytes).toBe(BigInt(350_000));
			expect(row.periodTxBytes).toBe(BigInt(160_000));
		});

		it("a long gap gives no rate (no long-run average) but still counts traffic", async () => {
			await writeLatestMetrics([sample(600 + 3_600, BigInt(150_000), BigInt(20_000))]);
			const row = await read();
			expect(row.rxRateBps).toBeNull();
			expect(row.periodRxBytes).toBe(BigInt(450_000));
		});

		it("an interface change contributes neither rate nor traffic", async () => {
			await writeLatestMetrics([sample(4_500, BigInt(5_000_000), BigInt(5_000_000), {}, "ens3")]);
			const row = await read();
			expect(row.rxRateBps).toBeNull();
			expect(row.periodRxBytes).toBe(BigInt(450_000));
			expect(row.netIface).toBe("ens3");
		});

		it("an offline verdict keeps the last metrics and updates the verdict", async () => {
			await writeLatestMetrics([{ serverId, checkedAt: at(4_800), online: false, offlineReason: "unreachable", intervalSeconds: 300, probe: { at: at(4_800), ok: false, latencyMs: null } }]);
			const row = await read();
			expect(row).toMatchObject({ online: false, offlineReason: "unreachable", probeOk: false, probeLatencyMs: null, cpuUsage: 10 });
			expect(row.metricsAt?.toISOString()).toBe(at(4_500).toISOString());
			// An older verdict cannot override a newer one.
			await writeLatestMetrics([{ serverId, checkedAt: at(4_700), online: true, intervalSeconds: 300 }]);
			expect((await read()).online).toBe(false);
		});

		it("a new month restarts the period counters", async () => {
			const nextMonth = new Date(startOfMonthInAppTimeZone(t0).getTime() + 40 * 86_400_000);
			await writeLatestMetrics([{ ...sample(0, BigInt(5_100_000), BigInt(5_100_000), {}, "ens3"), checkedAt: nextMonth, metrics: { sampledAt: nextMonth, source: "agent", values: values(BigInt(5_100_000), BigInt(5_100_000), "ens3") } }]);
			const row = await read();
			expect(row.periodRxBytes).toBe(BigInt(0));
			expect(row.periodSince?.toISOString()).toBe(nextMonth.toISOString());
			expect(row.metricsSource).toBe("agent");
		});

		it("rows for servers that no longer exist are skipped, not fatal", async () => {
			await expect(writeLatestMetrics([{ serverId: `${prefix}-missing`, checkedAt: t0, online: true, intervalSeconds: 60 }])).resolves.toBe(0);
		});
	});

	describe("history, coverage and rollup", () => {
		const serverId = ids.legacy;
		const now = new Date();
		const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

		beforeAll(async () => {
			await prisma.metricSnapshot.deleteMany({ where: { serverId } });
			await prisma.trafficSnapshot.deleteMany({ where: { serverId } });
			const rows = [];
			// 60..35 min ago: legacy rows (no interval, no probe), online.
			for (let m = 60; m >= 35; m -= 5) rows.push({ serverId, cpuUsage: 20, memUsage: 30, diskUsage: 40, isOnline: true, createdAt: minutesAgo(m) });
			// 35..15 min ago: nothing (sampler stopped).
			// 15..5 min ago: offline with failed probes at a recorded 5-minute interval.
			for (let m = 15; m >= 5; m -= 5) rows.push({ serverId, cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, createdAt: minutesAgo(m), intervalSeconds: 300, probeStatus: "failed" });
			// 4..1 min ago: online, 1-minute interval, successful probes.
			for (let m = 4; m >= 1; m -= 1) rows.push({ serverId, cpuUsage: 50, memUsage: 60, diskUsage: 70, isOnline: true, createdAt: minutesAgo(m), intervalSeconds: 60, probeStatus: "ok", probeLatencyMs: 10 + m });
			await prisma.metricSnapshot.createMany({ data: rows });
			const traffic = [
				{ m: 60, rx: BigInt(0), tx: BigInt(0) },
				{ m: 55, rx: BigInt(300_000), tx: BigInt(30_000) },
				{ m: 50, rx: BigInt(600_000), tx: BigInt(60_000) },
				{ m: 45, rx: BigInt(1_000), tx: BigInt(1_000) }, // reboot
				{ m: 40, rx: BigInt(301_000), tx: BigInt(31_000) },
			];
			await prisma.trafficSnapshot.createMany({ data: traffic.map((row) => ({ source: "server", serverId, iface: "eth0", rxBytes: row.rx, txBytes: row.tx, sampledAt: minutesAgo(row.m) })) });
		});

		it("buckets resources in SQL and leaves offline buckets without values", async () => {
			const rows = await queryResourceBuckets(serverId, minutesAgo(61), now, 60);
			expect(rows.length).toBe(6 + 3 + 4);
			const offline = rows.filter((row) => Number(row.offline) > 0);
			expect(offline.every((row) => row.cpu === null)).toBe(true);
			expect(offline.reduce((sum, row) => sum + Number(row.probe_failed), 0)).toBe(3);
			expect(rows.filter((row) => Number(row.probe_ok) > 0)).toHaveLength(4);
		});

		it("recomputes network rates from counters and drops the reboot step", async () => {
			const rows = await queryNetworkBuckets(serverId, minutesAgo(61), now, 60);
			const rates = rows.map((row) => Math.round(row.rx ?? -1));
			// 55, 50 and 40 minutes ago have rates (300000 B / 300 s = 1000 B/s); 45 is a reset.
			expect(rates).toEqual([1000, 1000, 1000]);
		});

		it("coverage is capped per sample and unknown time stays uncovered", async () => {
			const coverage = await queryCoverage(serverId, minutesAgo(61), now);
			expect(coverage.samples).toBe(13);
			// 5 legacy gaps of 5 min + the 35-min-ago row capped at 10 min,
			// 15→10→5 (10 min), 5-min-ago row capped at 1 min to the next (4 min ago)... ≈ 25+10+10+1+... minutes.
			expect(coverage.covered).toBeGreaterThan(40 * 60);
			expect(coverage.covered).toBeLessThan(55 * 60);
			expect(coverage.onlineCovered).toBeLessThan(coverage.covered);
		});

		it("public history: bounded points, gaps, honest latency counts", async () => {
			const history = await readPublicHistory(publicIdOf.get(ids.legacy)!, "1h");
			expect(history).not.toBeNull();
			expect(history!.resources!.length).toBeLessThanOrEqual(720);
			expect(history!.resources!.some((point) => point.cpu === null)).toBe(true);
			expect(history!.latency).toMatchObject({ probes: 7, failed: 3, measured: true });
			expect(history!.coveragePercent).toBeGreaterThan(60);
			expect(history!.coveragePercent).toBeLessThan(95);
		});

		it("the uptime rollup counts covered minutes from real sample times", async () => {
			const day = minutesAgo(0);
			await rollupServerUptimeForDay(day);
			const row = await prisma.serverUptimeSnapshot.findFirst({ where: { serverId, date: startOfDayInAppTimeZone(day) } });
			if (!row) return; // a run right after midnight puts the samples into yesterday
			expect(row.checkCount).toBeGreaterThanOrEqual(1);
			expect(row.onlineMinutes + row.offlineMinutes).toBeLessThanOrEqual(1440);
			expect(row.offlineMinutes).toBeGreaterThan(0);
		});
	});

	it("the sampler writes interval, probe outcome and the latest row together", async () => {
		const serverId = ids.hidden;
		await snapshotHealthOverview({
			total: 1, online: 0, warning: 0, critical: 0, offline: 1,
			servers: [{ serverId, serverName: "x", host: "203.0.113.12", enabled: true, status: "offline", probeStatus: "failed", lastCheck: new Date().toISOString() }],
		}, { intervalSeconds: 120 });
		const sample = await prisma.metricSnapshot.findFirstOrThrow({ where: { serverId }, orderBy: { createdAt: "desc" } });
		expect(sample).toMatchObject({ isOnline: false, intervalSeconds: 120, probeStatus: "failed", probeLatencyMs: null, teamId: teamA });
		const latest = await prisma.serverMetricLatest.findUniqueOrThrow({ where: { serverId } });
		expect(latest).toMatchObject({ online: false, offlineReason: "unreachable", intervalSeconds: 120, probeOk: false });
	});
});
