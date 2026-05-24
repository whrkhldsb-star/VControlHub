import { describe, expect, it } from "vitest";

import { parseDockerStats, sumDockerStats } from "../stats";

const RAW_STATS = {
	read: "2026-01-01T00:00:02.000000000Z",
	preread: "2026-01-01T00:00:00.000000000Z",
	cpu_stats: {
		cpu_usage: { total_usage: 3_000_000_000, percpu_usage: [1, 1] },
		system_cpu_usage: 20_000_000_000,
		online_cpus: 2,
	},
	precpu_stats: {
		cpu_usage: { total_usage: 1_000_000_000 },
		system_cpu_usage: 10_000_000_000,
	},
	memory_stats: {
		usage: 300 * 1024 * 1024,
		limit: 1024 * 1024 * 1024,
		stats: { cache: 44 * 1024 * 1024 },
	},
	networks: {
		eth0: { rx_bytes: 1000, tx_bytes: 2000 },
		eth1: { rx_bytes: 3000, tx_bytes: 4000 },
	},
	blkio_stats: {
		io_service_bytes_recursive: [
			{ op: "Read", value: 1024 },
			{ op: "Write", value: 2048 },
		],
	},
	pids_stats: { current: 8 },
};

describe("docker stats helpers", () => {
	it("normalizes Docker stats into dashboard-friendly metrics", () => {
		const stats = parseDockerStats("abc123", "web", RAW_STATS);

		expect(stats).toMatchObject({
			id: "abc123",
			name: "web",
			cpuPercent: 40,
			memoryUsageBytes: 256 * 1024 * 1024,
			memoryLimitBytes: 1024 * 1024 * 1024,
			memoryPercent: 25,
			networkRxBytes: 4000,
			networkTxBytes: 6000,
			blockReadBytes: 1024,
			blockWriteBytes: 2048,
			pids: 8,
		});
	});

	it("sums multiple container stats for compose/project cards", () => {
		const one = parseDockerStats("one", "one", RAW_STATS);
		const two = { ...one, id: "two", cpuPercent: 10, networkRxBytes: 50, networkTxBytes: 60 };

		const total = sumDockerStats([one, two]);

		expect(total.cpuPercent).toBe(50);
		expect(total.networkRxBytes).toBe(4050);
		expect(total.networkTxBytes).toBe(6060);
		expect(total.containerCount).toBe(2);
	});
});
