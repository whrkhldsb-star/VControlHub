import { describe, expect, it } from "vitest";

import { fullestDisk, normalizeServerMetrics, parseDfSizeLabel, parseUptimeSeconds } from "../normalize";
import { classifyPublicNode, freshnessWindowMs, type StatusInput } from "../status";
import { formatAge, formatDuration, formatIecBytes, formatIecRate, formatLatency, formatPercent } from "../format";

describe("normalize", () => {
	it("parses df -h labels with binary multipliers", () => {
		expect(parseDfSizeLabel("50G")).toBe(50 * 1024 ** 3);
		expect(parseDfSizeLabel("1.5T")).toBe(1.5 * 1024 ** 4);
		expect(parseDfSizeLabel("512M")).toBe(512 * 1024 ** 2);
		expect(parseDfSizeLabel("0")).toBe(0);
		expect(parseDfSizeLabel("n/a")).toBeNull();
		expect(parseDfSizeLabel(undefined)).toBeNull();
	});

	it("parses uptime fragments and full lines", () => {
		expect(parseUptimeSeconds("3 days, 4:05")).toBe(3 * 86_400 + 4 * 3_600 + 5 * 60);
		expect(parseUptimeSeconds("1 day, 12 min")).toBe(86_400 + 12 * 60);
		expect(parseUptimeSeconds("45 min")).toBe(45 * 60);
		expect(parseUptimeSeconds("4:05")).toBe(4 * 3_600 + 5 * 60);
		expect(parseUptimeSeconds(" 16:54:33 up 1 day, 23:48,  4 users,  load average: 3.68, 3.26, 2.93")).toBe(86_400 + 23 * 3_600 + 48 * 60);
		expect(parseUptimeSeconds("unknown")).toBeNull();
		expect(parseUptimeSeconds("")).toBeNull();
	});

	it("keeps only numbers, prefers a physical interface and never invents zeros", () => {
		const values = normalizeServerMetrics({
			cpu: { usagePercent: 12.34, cores: 4, loadAvg: [0.5, 0.4, 0.3] },
			memory: { totalMb: 0, usedMb: 0, availableMb: 0, usagePercent: 0 },
			disk: [
				{ mount: "/data", totalGb: "100G", usedGb: "90G", usagePercent: 90 },
				{ mount: "/", totalGb: "20G", usedGb: "5G", usagePercent: 25 },
			],
			network: [
				{ iface: "docker0", rxBytes: 9e12, txBytes: 9e12 },
				{ iface: "eth0", rxBytes: 1000, txBytes: 2000 },
			],
			uptime: "unknown",
			timestamp: "2026-10-13T00:00:00.000Z",
		});
		expect(values).toMatchObject({
			cpuUsage: 12.34,
			cpuCores: 4,
			load1: 0.5,
			// No MemTotal: memory is unknown, not 0 %.
			memUsage: null,
			memUsedMb: null,
			memTotalMb: null,
			// Percent and sizes both describe the fullest partition (/data).
			diskUsage: 90,
			diskUsedBytes: 90 * 1024 ** 3,
			diskTotalBytes: 100 * 1024 ** 3,
			uptimeSeconds: null,
			netIface: "eth0",
			netRxBytes: BigInt(1000),
			netTxBytes: BigInt(2000),
		});
		expect(Object.keys(values).sort()).toEqual([
			"arch", "cpuCores", "cpuModel", "cpuUsage", "diskTotalBytes", "diskUsage", "diskUsedBytes", "kernelVersion", "load1", "load15", "load5",
			"memTotalMb", "memUsage", "memUsedMb", "netIface", "netRxBytes", "netTxBytes", "osName", "processCount", "swapUsage",
			"tcpConnections", "udpConnections", "uptimeSeconds", "virtualization",
		]);
	});
});

describe("disk partition", () => {
	const sample = (disk: Array<{ mount: string; totalGb: string; usedGb: string; usagePercent: number }>) => normalizeServerMetrics({
		cpu: { usagePercent: 1, cores: 1, loadAvg: [0, 0, 0] },
		memory: { totalMb: 100, usedMb: 20, availableMb: 80, usagePercent: 20 },
		disk,
		network: [],
		uptime: "1 day",
		timestamp: "2026-10-15T00:00:00Z",
	});

	it("never pairs one partition's percent with another partition's sizes", () => {
		// Root 20 of 100 GiB, /data 90 of 400 GiB: distinct sizes on purpose.
		const values = sample([
			{ mount: "/", totalGb: "100G", usedGb: "20G", usagePercent: 20 },
			{ mount: "/data", totalGb: "400G", usedGb: "360G", usagePercent: 90 },
		]);
		expect(values).toMatchObject({ diskUsage: 90, diskUsedBytes: 360 * 1024 ** 3, diskTotalBytes: 400 * 1024 ** 3 });
	});

	it("keeps df's own percent (reserved blocks, rounding) rather than recomputing it", () => {
		// ext4 reserves ~5 %: df reports 47 % for 9.0G used of 20G.
		const values = sample([
			{ mount: "/", totalGb: "20G", usedGb: "9.0G", usagePercent: 47 },
			{ mount: "/boot", totalGb: "974M", usedGb: "200M", usagePercent: 22 },
		]);
		expect(values).toMatchObject({ diskUsage: 47, diskUsedBytes: 9 * 1024 ** 3, diskTotalBytes: 20 * 1024 ** 3 });
	});

	it("prefers / on a tie, skips non-numeric percents and stays null without disks", () => {
		const tie = [
			{ mount: "/srv", totalGb: "50G", usedGb: "25G", usagePercent: 50 },
			{ mount: "/", totalGb: "10G", usedGb: "5G", usagePercent: 50 },
			{ mount: "/mnt/odd", totalGb: "1G", usedGb: "1G", usagePercent: Number.NaN },
		];
		expect(fullestDisk(tie)?.mount).toBe("/");
		expect(sample(tie)).toMatchObject({ diskUsage: 50, diskUsedBytes: 5 * 1024 ** 3, diskTotalBytes: 10 * 1024 ** 3 });
		expect(sample([])).toMatchObject({ diskUsage: null, diskUsedBytes: null, diskTotalBytes: null });
	});
});

describe("classifyPublicNode", () => {
	const now = new Date("2026-10-13T12:00:00.000Z");
	const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
	const base: StatusInput = { maintenance: false, managementMode: "DIRECT", agentLastSeenAt: null, latest: null, now };

	it("unknown when never sampled", () => {
		expect(classifyPublicNode(base)).toMatchObject({ status: "unknown", metricsStale: false });
	});

	it("online / offline from a fresh verdict, with the offline reason", () => {
		const latest = { checkedAt: ago(60), online: true, offlineReason: null, metricsAt: ago(60), intervalSeconds: 300 };
		expect(classifyPublicNode({ ...base, latest })).toMatchObject({ status: "online", metricsStale: false });
		expect(classifyPublicNode({ ...base, latest: { ...latest, online: false, offlineReason: "collect_failed" } })).toMatchObject({ status: "offline", offlineReason: "collect_failed" });
		expect(classifyPublicNode({ ...base, latest: { ...latest, online: false, offlineReason: null } })).toMatchObject({ status: "offline", offlineReason: "unreachable" });
	});

	it("stale (never green) when the sampler stopped", () => {
		const latest = { checkedAt: ago(3_600), online: true, offlineReason: null, metricsAt: ago(3_600), intervalSeconds: 300 };
		expect(classifyPublicNode({ ...base, latest })).toMatchObject({ status: "stale", metricsStale: true });
	});

	it("freshness follows the interval recorded by the writer", () => {
		expect(freshnessWindowMs(300)).toBe(900_000);
		expect(freshnessWindowMs(60)).toBe(180_000);
		expect(freshnessWindowMs(null)).toBe(900_000);
		expect(freshnessWindowMs(1_800)).toBe(5_400_000);
		// A 30-minute sampler: 40 minutes old is still current, 2 hours is stale.
		const slow = (age: number) => ({ checkedAt: ago(age), online: true, offlineReason: null, metricsAt: ago(age), intervalSeconds: 1_800 });
		expect(classifyPublicNode({ ...base, latest: slow(2_400) }).status).toBe("online");
		expect(classifyPublicNode({ ...base, latest: slow(7_200) }).status).toBe("stale");
	});

	it("Agent: a fresh heartbeat is online but old metrics are flagged separately", () => {
		const result = classifyPublicNode({
			...base,
			managementMode: "AGENT",
			agentLastSeenAt: ago(20),
			latest: { checkedAt: ago(600), online: true, offlineReason: null, metricsAt: ago(600), intervalSeconds: 60 },
		});
		expect(result).toMatchObject({ status: "online", heartbeatFresh: true, metricsStale: true });
	});

	it("Agent heartbeat lost and no newer verdict → stale", () => {
		expect(classifyPublicNode({ ...base, managementMode: "AGENT", agentLastSeenAt: ago(900), latest: null }).status).toBe("stale");
	});

	it("maintenance overrides everything", () => {
		const latest = { checkedAt: ago(10), online: false, offlineReason: "unreachable", metricsAt: null, intervalSeconds: 300 };
		expect(classifyPublicNode({ ...base, maintenance: true, latest }).status).toBe("maintenance");
	});
});

describe("format (IEC units, no fabricated zeros)", () => {
	it("labels binary units explicitly", () => {
		expect(formatIecBytes(1536)).toBe("1.50 KiB");
		expect(formatIecBytes(5 * 1024 ** 3)).toBe("5.00 GiB");
		expect(formatIecRate(2048)).toBe("2.00 KiB/s");
		expect(formatIecRate(512)).toBe("512 B/s");
		expect(formatIecRate(null)).toBe("—");
		expect(formatIecBytes(undefined)).toBe("—");
		expect(formatPercent(null)).toBe("—");
		expect(formatPercent(7.25)).toBe("7.3%");
		expect(formatLatency(12.345)).toBe("12.3 ms");
	});

	it("formats durations and ages", () => {
		expect(formatDuration(3 * 86_400 + 4 * 3_600, "zh")).toBe("3 天 4 小时");
		expect(formatDuration(3_700, "en")).toBe("1h 1m");
		expect(formatAge("2026-10-13T11:59:30.000Z", Date.parse("2026-10-13T12:00:00.000Z"), "en")).toBe("30s ago");
		expect(formatAge(null, 0, "zh")).toBe("—");
	});
});
