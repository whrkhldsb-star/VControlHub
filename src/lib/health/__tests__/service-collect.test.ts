import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the TR-050 health collection integration: the lightweight TCP
 * probe must run BEFORE the heavy SSH pull, and its result must drive
 * whether we mark a server offline (network unreachable) vs warning (host up
 * but SSH unreachable) vs healthy / critical (full metrics).
 *
 * The two upstream collaborators (`collectServerMetrics` and `tcpProbe`) are
 * stubbed; this file does not exercise real sockets.
 */

const { prismaMock, collectServerMetricsMock, tcpProbeMock } = vi.hoisted(() => ({
	prismaMock: {
		server: {
			findMany: vi.fn(),
		},
	},
	collectServerMetricsMock: vi.fn(),
	tcpProbeMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/server/monitor", () => ({
	collectServerMetrics: collectServerMetricsMock,
}));
vi.mock("@/lib/server/connectivity", () => ({ tcpProbe: tcpProbeMock }));

import { collectAllHealth } from "../service-collect";

function goodMetrics() {
	return {
		cpu: { usagePercent: 30, cores: 4, loadAvg: [0.1, 0.1, 0.1] },
		memory: { totalMb: 16000, usedMb: 4000, availableMb: 12000, usagePercent: 25 },
		disk: [{ mount: "/", totalGb: "40G", usedGb: "10G", usagePercent: 25 }],
		network: [],
		uptime: "up 1 day",
		timestamp: new Date("2026-06-16T00:00:00Z").toISOString(),
	};
}

function highMetrics() {
	return {
		...goodMetrics(),
		cpu: { usagePercent: 98, cores: 4, loadAvg: [4, 4, 4] },
	};
}

describe("collectAllHealth — TR-050 TCP probe integration", () => {
	beforeEach(() => {
		// resetAllMocks (not clearAllMocks) so .mockResolvedValueOnce queues
		// from previous tests don't leak — collectServerMetrics and tcpProbe
		// both use the once-queue pattern in the rollup test below.
		vi.resetAllMocks();
	});

	it("returns immediately for disabled servers without running the TCP probe", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Disabled", host: "10.0.0.1", port: 22, enabled: false },
		]);

		const result = await collectAllHealth();

		expect(tcpProbeMock).not.toHaveBeenCalled();
		expect(collectServerMetricsMock).not.toHaveBeenCalled();
		expect(result.total).toBe(1);
		expect(result.offline).toBe(1);
		expect(result.servers[0]?.status).toBe("offline");
		expect(result.servers[0]?.enabled).toBe(false);
	});

	it("marks a server offline with 网络不可达 reason when the TCP probe fails", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Unreachable", host: "10.0.0.1", port: 22, enabled: true },
		]);
		tcpProbeMock.mockResolvedValueOnce({ ok: false, error: "ECONNREFUSED" });
		collectServerMetricsMock.mockResolvedValueOnce(goodMetrics());

		const result = await collectAllHealth();

		expect(tcpProbeMock).toHaveBeenCalledWith("10.0.0.1", 22, 2_000);
		// SSH pull should be SKIPPED — no point asking the daemon if the
		// host isn't even answering on the network.
		expect(collectServerMetricsMock).not.toHaveBeenCalled();
		expect(result.servers[0]?.status).toBe("offline");
		expect(result.servers[0]?.error).toContain("网络不可达");
		expect(result.servers[0]?.error).toContain("ECONNREFUSED");
		expect(result.servers[0]?.latencyMs).toBeUndefined();
	});

	it("marks a server warning (not offline) when TCP succeeds but SSH fails", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "SshDown", host: "10.0.0.1", port: 22, enabled: true },
		]);
		tcpProbeMock.mockResolvedValueOnce({ ok: true, latencyMs: 7 });
		collectServerMetricsMock.mockResolvedValueOnce({ error: "SSH 命令执行失败" });

		const result = await collectAllHealth();

		expect(tcpProbeMock).toHaveBeenCalledTimes(1);
		expect(collectServerMetricsMock).toHaveBeenCalledTimes(1);
		expect(result.servers[0]?.status).toBe("warning");
		expect(result.servers[0]?.error).toContain("SSH 不可达");
		expect(result.servers[0]?.error).toContain("RTT 7ms");
		expect(result.servers[0]?.latencyMs).toBe(7);
	});

	it("treats a thrown collectServerMetrics as warning, not offline, when TCP succeeded", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Throwing", host: "10.0.0.1", port: 22, enabled: true },
		]);
		tcpProbeMock.mockResolvedValueOnce({ ok: true, latencyMs: 12 });
		collectServerMetricsMock.mockRejectedValueOnce(new Error("decrypt failed"));

		const result = await collectAllHealth();

		expect(result.servers[0]?.status).toBe("warning");
		expect(result.servers[0]?.error).toContain("采集失败");
		expect(result.servers[0]?.error).toContain("decrypt failed");
		expect(result.servers[0]?.latencyMs).toBe(12);
	});

	it("returns healthy with latencyMs when both TCP and SSH succeed with good metrics", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Healthy", host: "10.0.0.1", port: 22, enabled: true },
		]);
		tcpProbeMock.mockResolvedValueOnce({ ok: true, latencyMs: 3 });
		collectServerMetricsMock.mockResolvedValueOnce(goodMetrics());

		const result = await collectAllHealth();

		expect(result.servers[0]?.status).toBe("healthy");
		expect(result.servers[0]?.latencyMs).toBe(3);
		expect(result.servers[0]?.cpu).toBe(30);
		expect(result.servers[0]?.error).toBeUndefined();
	});

	it("returns critical when TCP + SSH succeed and metrics exceed thresholds", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Hot", host: "10.0.0.1", port: 22, enabled: true },
		]);
		tcpProbeMock.mockResolvedValueOnce({ ok: true, latencyMs: 4 });
		collectServerMetricsMock.mockResolvedValueOnce(highMetrics());

		const result = await collectAllHealth();

		expect(result.servers[0]?.status).toBe("critical");
		expect(result.servers[0]?.latencyMs).toBe(4);
		expect(result.servers[0]?.cpu).toBe(98);
	});

	it("rolls up counts across the 4 enabled states plus disabled", async () => {
		prismaMock.server.findMany.mockResolvedValueOnce([
			{ id: "s1", name: "Healthy", host: "10.0.0.1", port: 22, enabled: true },
			{ id: "s2", name: "Hot", host: "10.0.0.2", port: 22, enabled: true },
			{ id: "s3", name: "SshDown", host: "10.0.0.3", port: 22, enabled: true },
			{ id: "s4", name: "Unreachable", host: "10.0.0.4", port: 22, enabled: true },
			{ id: "s5", name: "Disabled", host: "10.0.0.5", port: 22, enabled: false },
		]);
		tcpProbeMock
			.mockResolvedValueOnce({ ok: true, latencyMs: 1 })
			.mockResolvedValueOnce({ ok: true, latencyMs: 2 })
			.mockResolvedValueOnce({ ok: true, latencyMs: 3 })
			.mockResolvedValueOnce({ ok: false, error: "EHOSTUNREACH" });
		collectServerMetricsMock
			.mockResolvedValueOnce(goodMetrics())
			.mockResolvedValueOnce(highMetrics())
			.mockResolvedValueOnce({ error: "auth fail" });
		// The unreachable case skips the SSH call entirely.

		const result = await collectAllHealth();

		expect(result.total).toBe(5);
		expect(result.online).toBe(1);
		expect(result.critical).toBe(1);
		expect(result.warning).toBe(1);
		// offline counts both the unreachable and the disabled server.
		expect(result.offline).toBe(2);
	});
});
