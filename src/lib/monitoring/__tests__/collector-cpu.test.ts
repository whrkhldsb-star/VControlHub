import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSyncMock = vi.fn<(path: string) => string>();

vi.mock("node:fs", () => {
	const fs = {
		readFileSync: (path: string) => readFileSyncMock(String(path)),
		// The CPU gauge is all this file exercises; the other collectors are fed
		// nothing and fall back to their empty/"N/A" branches.
		readdirSync: () => [] as string[],
		statfsSync: () => {
			throw new Error("statfs unavailable in test");
		},
	};
	// node:fs is also consumed as a default import elsewhere in the graph.
	return { ...fs, default: fs };
});

import { __resetCpuBaselineForTests, collectMonitoringStats } from "../collector";

/** Aggregate /proc/stat line: user nice system idle iowait … */
function procStat(busy: number, idle: number) {
	return `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 ${busy} 0 0 ${idle} 0\n`;
}

function withStat(text: string) {
	readFileSyncMock.mockImplementation((path: string) =>
		path === "/proc/stat" ? text : "",
	);
}

describe("collectMonitoringStats CPU usage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		__resetCpuBaselineForTests();
	});

	it("reports the boot average for the very first sample", () => {
		withStat(procStat(200, 800));
		expect(collectMonitoringStats().cpu.usage).toBe("20.0%");
	});

	it("diffs against the previous sample instead of the whole uptime", () => {
		// Boot average is 1% busy, but the last window was 90% busy. Reading
		// /proc/stat once reported 1% — a gauge that never moves off idle.
		withStat(procStat(100, 9900));
		expect(collectMonitoringStats().cpu.usage).toBe("1.0%");
		withStat(procStat(1000, 10_000));
		expect(collectMonitoringStats().cpu.usage).toBe("90.0%");
	});

	it("keeps the previous window when two calls land in the same jiffy", () => {
		withStat(procStat(100, 900));
		collectMonitoringStats();
		withStat(procStat(600, 900));
		expect(collectMonitoringStats().cpu.usage).toBe("100.0%");
		// No counter movement: report the last measured window rather than N/A,
		// and keep the baseline so the next real tick still has a window.
		expect(collectMonitoringStats().cpu.usage).toBe("100.0%");
		withStat(procStat(600, 1400));
		expect(collectMonitoringStats().cpu.usage).toBe("0.0%");
	});

	it("falls back to N/A, not N/A%, when /proc/stat is unreadable", () => {
		readFileSyncMock.mockImplementation(() => {
			throw new Error("EACCES");
		});
		expect(collectMonitoringStats().cpu.usage).toBe("N/A");
	});
});
