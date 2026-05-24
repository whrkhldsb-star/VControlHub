import { describe, expect, it } from "vitest";

import {
	calculateTrafficRate,
	formatBytes,
	formatBytesPerSecond,
	parseNetworkDeviceStats,
	selectPrimaryInterface,
} from "../traffic";

const SAMPLE_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 1 0 0 0 0 0 0 2000 1 0 0 0 0 0 0
  eth0: 123456789 100 0 0 0 0 0 0 987654321 200 0 0 0 0 0 0
 docker0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0
`;

describe("traffic helpers", () => {
	it("parses /proc/net/dev and ignores loopback by default", () => {
		const interfaces = parseNetworkDeviceStats(SAMPLE_NET_DEV);

		expect(interfaces).toEqual([
			{ iface: "eth0", rxBytes: 123456789, txBytes: 987654321 },
			{ iface: "docker0", rxBytes: 100, txBytes: 200 },
		]);
	});

	it("selects the first physical-looking interface before docker bridges", () => {
		const interfaces = parseNetworkDeviceStats(SAMPLE_NET_DEV);

		expect(selectPrimaryInterface(interfaces)?.iface).toBe("eth0");
	});

	it("computes rates from two samples without allowing counter resets to go negative", () => {
		const rate = calculateTrafficRate(
			{ rxBytes: 1_000, txBytes: 2_000, sampledAt: "2026-01-01T00:00:00.000Z" },
			{ rxBytes: 2_500, txBytes: 2_800, sampledAt: "2026-01-01T00:00:05.000Z" },
		);

		expect(rate).toEqual({ rxBytesPerSecond: 300, txBytesPerSecond: 160, intervalSeconds: 5 });

		const reset = calculateTrafficRate(
			{ rxBytes: 5_000, txBytes: 5_000, sampledAt: "2026-01-01T00:00:00.000Z" },
			{ rxBytes: 100, txBytes: 200, sampledAt: "2026-01-01T00:00:05.000Z" },
		);
		expect(reset).toEqual({ rxBytesPerSecond: 0, txBytesPerSecond: 0, intervalSeconds: 5 });
	});

	it("formats bytes and rates for dashboard display", () => {
		expect(formatBytes(999)).toBe("999 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
		expect(formatBytesPerSecond(1536)).toBe("1.5 KB/s");
	});
});
