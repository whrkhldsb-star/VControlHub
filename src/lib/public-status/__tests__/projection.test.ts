import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/status/service", () => ({ getPublicStatusSummary: vi.fn() }));

import { applyBoardQuery, effectiveSort, summarizeNodes, toPublicNode, type VisibleNodeRow } from "../projection";
import { PUBLIC_METRIC_CATEGORIES, type PublicMetricCategory } from "../site-config";
import { DEFAULT_BOARD_QUERY, parseBoardQuery, boardQueryToSearch } from "../query";
import { publicationHiddenReason } from "../visibility";
import type { PublicNode } from "../types";

const now = new Date("2026-10-13T12:00:00.000Z");
const ALL = new Set<PublicMetricCategory>(PUBLIC_METRIC_CATEGORIES);

function row(overrides: Partial<VisibleNodeRow> = {}): VisibleNodeRow {
	return {
		serverId: "srv_internal_1",
		publicId: "abcdefghijkl",
		displayName: "Tokyo 1",
		groupName: "Asia",
		region: "JP",
		tags: ["prod"],
		sortOrder: 0,
		note: null,
		maintenance: false,
		managementMode: "DIRECT",
		agentLastSeenAt: null,
		checkedAt: new Date(now.getTime() - 60_000),
		online: true,
		offlineReason: null,
		metricsAt: new Date(now.getTime() - 60_000),
		intervalSeconds: 300,
		cpuUsage: 12.345,
		cpuCores: 2,
		load1: 0.1234,
		load5: 0.2,
		load15: 0.3,
		memUsage: 50,
		memUsedMb: 1024,
		memTotalMb: 2048,
		swapUsage: null,
		diskUsage: 40,
		diskUsedBytes: 4e9,
		diskTotalBytes: 10e9,
		uptimeSeconds: 3600,
		rxRateBps: 1000.4,
		txRateBps: 2000.6,
		rateIntervalSeconds: 300,
		periodStart: new Date("2026-09-30T16:00:00.000Z"),
		periodSince: new Date("2026-10-01T00:00:00.000Z"),
		periodRxBytes: BigInt(10),
		periodTxBytes: BigInt(20),
		probeAt: new Date(now.getTime() - 60_000),
		probeOk: true,
		probeLatencyMs: 23.456,
		countryCode: "jp",
		arch: "x86_64",
		kernelVersion: "6.8.0-45-generic",
		osName: "Ubuntu 24.04.1 LTS",
		cpuModel: "AMD EPYC 7763",
		virtualization: "kvm",
		processCount: 123,
		tcpConnections: 45,
		udpConnections: 6,
		osInfo: "Debian GNU/Linux 12",
		operatingSystem: "LINUX",
		expiresAt: new Date("2026-11-01T15:59:59.000Z"),
		trafficQuotaBytes: BigInt(1024 ** 4),
		trafficQuotaMode: "out",
		costMonthlyAmount: 5.5,
		costCurrency: "USD",
		...overrides,
	};
}

const FORBIDDEN = /srv_internal|203\.0\.113|root@|BEGIN|agentMetricsRaw|osDialect|teamId|serverId|password|token|===CPU===/i;

describe("toPublicNode whitelist", () => {
	it("copies only public fields even when the row carries internal columns", () => {
		const dirty = Object.assign(row(), {
			host: "203.0.113.7",
			port: 22,
			username: "root",
			password: "secret",
			agentMetricsRaw: "===CPU===",
			osDialect: "{}",
			teamId: "team_1",
			agentLastError: "boom",
		}) as VisibleNodeRow;
		const node = toPublicNode(dirty, ALL, now);
		const json = JSON.stringify(node);
		expect(json).not.toMatch(FORBIDDEN);
		expect(Object.keys(node).sort()).toEqual([
			"billing", "checkedAt", "countryCode", "group", "heartbeatAt", "id", "metrics", "metricsAt", "metricsStale", "name", "note",
			"offlineReason", "region", "reportIntervalSeconds", "status", "system", "tags",
		]);
		expect(node).toMatchObject({ id: "abcdefghijkl", name: "Tokyo 1", status: "online" });
		expect(node.metrics.memory).toEqual({ usage: 50, usedBytes: 1024 * 1024 * 1024, totalBytes: 2048 * 1024 * 1024, swapUsage: null });
		expect(node.metrics.network).toEqual({ rxBytesPerSecond: 1000, txBytesPerSecond: 2001, rateWindowSeconds: 300 });
		expect(node.metrics.traffic).toMatchObject({ periodRxBytes: 10, periodTxBytes: 20 });
		expect(node.metrics.latency).toMatchObject({ ms: 23.5, ok: true });
	});

	it("omits categories the site does not publish", () => {
		const node = toPublicNode(row(), new Set<PublicMetricCategory>(["cpu"]), now);
		expect(Object.keys(node.metrics)).toEqual(["cpu"]);
		expect(node.system).toBeNull();
		expect(node.billing).toBeNull();
		// The flag is part of the public name, not a metric.
		expect(node.countryCode).toBe("JP");
	});

	it("publishes what the node is, its connections, quota and billing when the site shows them", () => {
		const node = toPublicNode(row(), ALL, now);
		expect(node.system).toEqual({ os: "Ubuntu 24.04.1 LTS", arch: "x86_64", kernel: "6.8.0-45-generic", cpuModel: "AMD EPYC 7763", virtualization: "kvm" });
		expect(node.metrics.connections).toEqual({ processes: 123, tcp: 45, udp: 6 });
		expect(node.metrics.traffic?.quota).toEqual({ limitBytes: 1024 ** 4, mode: "out" });
		expect(node.billing).toEqual({ monthlyPrice: 5.5, currency: "USD", expiresAt: "2026-11-01T15:59:59.000Z" });
	});

	it("falls back to the distro recorded at onboarding and drops empty facts and prices", () => {
		const node = toPublicNode(
			row({ osName: null, arch: null, kernelVersion: null, cpuModel: null, virtualization: null, costMonthlyAmount: 0, expiresAt: null, trafficQuotaBytes: null, trafficQuotaMode: "bogus" }),
			ALL,
			now,
		);
		expect(node.system).toEqual({ os: "Debian GNU/Linux 12", arch: null, kernel: null, cpuModel: null, virtualization: null });
		expect(node.billing).toBeNull();
		expect(node.metrics.traffic).not.toHaveProperty("quota");
		const bare = toPublicNode(row({ osName: null, osInfo: "\u001b\u0007\t", arch: null, kernelVersion: null, cpuModel: null, virtualization: null }), ALL, now);
		expect(bare.system).toBeNull();
		const placeholder = toPublicNode(row({ osName: null, osInfo: "Unknown (default: Debian)", arch: null, kernelVersion: null, cpuModel: null, virtualization: null }), ALL, now);
		expect(placeholder.system).toBeNull();
		const windows = toPublicNode(row({ osName: null, osInfo: null, operatingSystem: "WINDOWS" }), ALL, now);
		expect(windows.system?.os).toBe("Windows");
	});

	it("keeps billing off the default category list", async () => {
		const { DEFAULT_PUBLIC_METRICS } = await import("../site-config");
		expect(DEFAULT_PUBLIC_METRICS).not.toContain("billing");
		expect(DEFAULT_PUBLIC_METRICS).toEqual(expect.arrayContaining(["system", "connections"]));
	});

	it("shows no metric objects (not zeros) before the first sample", () => {
		const node = toPublicNode(row({ checkedAt: null, online: null, metricsAt: null, probeAt: null, cpuUsage: null }), ALL, now);
		expect(node.status).toBe("unknown");
		expect(node.metrics).toEqual({});
	});

	it("drops current rates when metrics are stale or the node is offline", () => {
		const stale = toPublicNode(row({ checkedAt: new Date(now.getTime() - 7_200_000), metricsAt: new Date(now.getTime() - 7_200_000) }), ALL, now);
		expect(stale.status).toBe("stale");
		expect(stale.metrics.network).toEqual({ rxBytesPerSecond: null, txBytesPerSecond: null, rateWindowSeconds: null });
	});

	it("reports a failed probe as failed, without a latency value", () => {
		const node = toPublicNode(row({ probeOk: false, probeLatencyMs: null }), ALL, now);
		expect(node.metrics.latency).toMatchObject({ ms: null, ok: false });
	});

	it("only Agent nodes expose a heartbeat time", () => {
		const at = new Date(now.getTime() - 10_000);
		expect(toPublicNode(row({ agentLastSeenAt: at }), ALL, now).heartbeatAt).toBeNull();
		expect(toPublicNode(row({ managementMode: "AGENT", agentLastSeenAt: at }), ALL, now).heartbeatAt).toBe(at.toISOString());
	});
});

function makeNodes(count: number): PublicNode[] {
	return Array.from({ length: count }, (_, i) =>
		toPublicNode(
			row({
				publicId: `node${String(i).padStart(8, "0")}`,
				displayName: `Node ${String(i).padStart(3, "0")}`,
				groupName: i % 2 ? "Odd" : "Even",
				region: i % 3 ? "EU" : "Asia",
				tags: i % 5 === 0 ? ["gpu"] : [],
				cpuUsage: i % 7 === 0 ? null : (i * 37) % 100,
				online: i % 10 !== 0,
				offlineReason: i % 10 === 0 ? "unreachable" : null,
			}),
			ALL,
			now,
		),
	);
}

describe("board query", () => {
	const nodes = makeNodes(513);

	it("pages through every node: nothing is silently cut off", () => {
		const seen = new Set<string>();
		let page = 1;
		for (;;) {
			const result = applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, pageSize: 100, page }, ALL);
			result.nodes.forEach((node) => seen.add(node.id));
			expect(result.filteredTotal).toBe(513);
			if (page >= result.totalPages) break;
			page += 1;
		}
		expect(page).toBe(6);
		expect(seen.size).toBe(513);
	});

	it("clamps a page beyond the end to the last page", () => {
		const result = applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, pageSize: 100, page: 99 }, ALL);
		expect(result.query.page).toBe(6);
		expect(result.nodes).toHaveLength(13);
	});

	it("searches public name, region, group and tags only", () => {
		expect(applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, q: "gpu", pageSize: 100 }, ALL).filteredTotal).toBe(103);
		expect(applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, q: "node 01", pageSize: 100 }, ALL).filteredTotal).toBe(10);
		expect(applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, q: "srv_internal", pageSize: 100 }, ALL).filteredTotal).toBe(0);
	});

	it("filters by group and status", () => {
		const result = applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, group: "Even", status: "offline", pageSize: 100 }, ALL);
		expect(result.filteredTotal).toBe(52);
		expect(result.nodes.every((node) => node.group === "Even" && node.status === "offline")).toBe(true);
	});

	it("sorts by load with unknown values last in both directions", () => {
		for (const dir of ["asc", "desc"] as const) {
			const result = applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, sort: "cpu", dir, pageSize: 100, page: 6 }, ALL);
			expect(result.nodes.at(-1)?.metrics.cpu?.usage).toBeNull();
		}
		const asc = applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, sort: "cpu", pageSize: 100 }, ALL).nodes.map((n) => n.metrics.cpu!.usage!);
		expect(asc).toEqual([...asc].sort((a, b) => a - b));
	});

	it("cannot sort on a metric the site hides (no ordering side channel)", () => {
		const cpuOnly = new Set<PublicMetricCategory>(["memory"]);
		expect(effectiveSort("cpu", cpuOnly)).toBe("default");
		expect(applyBoardQuery(nodes, { ...DEFAULT_BOARD_QUERY, sort: "cpu" }, cpuOnly).query.sort).toBe("default");
	});

	it("parses and serialises URL state with bounds", () => {
		const parsed = parseBoardQuery(new URLSearchParams("q=%20tok%20&status=bogus&sort=memory&dir=desc&page=0&pageSize=5000"));
		expect(parsed).toEqual({ q: "tok", group: "", status: "all", sort: "memory", dir: "desc", page: 1, pageSize: 100 });
		expect(boardQueryToSearch(parsed)).toBe("q=tok&sort=memory&dir=desc&pageSize=100");
		expect(boardQueryToSearch(DEFAULT_BOARD_QUERY)).toBe("");
	});
});

describe("summary", () => {
	it("counts statuses, groups and regions, and sums only known rates", () => {
		const nodes = makeNodes(20);
		const summary = summarizeNodes(nodes, false);
		expect(summary.total).toBe(20);
		expect(summary.online + summary.offline).toBe(20);
		expect(summary.offline).toBe(2);
		expect(summary.groups.map((g) => g.name)).toEqual(["Even", "Odd"]);
		expect(summary.regions.map((r) => r.name)).toEqual(["Asia", "EU"]);
		expect(summary.countries).toEqual([{ name: "JP", total: 20, online: 18 }]);
		// Offline nodes have no current rate; 18 online nodes contribute.
		expect(summary.rateNodes).toBe(18);
		expect(summary.rxBytesPerSecond).toBe(18 * 1000);
		expect(summarizeNodes([], true)).toMatchObject({ total: 0, rxBytesPerSecond: null, periodRxBytes: null, lastSampleAt: null, truncated: true });
	});
});

describe("visibility", () => {
	const base = { published: true, publishedTeamId: "t1", server: { enabled: true, teamId: "t1", team: { deletedAt: null } } };
	it("explains why a publication is hidden", () => {
		expect(publicationHiddenReason(base)).toBeNull();
		expect(publicationHiddenReason({ ...base, published: false })).toBe("unpublished");
		expect(publicationHiddenReason({ ...base, server: { ...base.server, enabled: false } })).toBe("server_disabled");
		expect(publicationHiddenReason({ ...base, server: { ...base.server, teamId: "t2" } })).toBe("owner_changed");
		expect(publicationHiddenReason({ ...base, server: { ...base.server, team: { deletedAt: new Date() } } })).toBe("customer_deleted");
		expect(publicationHiddenReason({ published: true, publishedTeamId: null, server: { enabled: true, teamId: null, team: null } })).toBeNull();
	});
});
