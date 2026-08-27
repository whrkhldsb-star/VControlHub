import { describe, expect, it } from "vitest";

import {
	countEstablishedSockets,
	cpuBusyPercent,
	parseCpuTotals,
	parseProcessStat,
} from "../collector";

describe("parseCpuTotals", () => {
	it("sums the aggregate line and keeps idle+iowait apart", () => {
		const totals = parseCpuTotals("cpu  100 20 30 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5\n");
		expect(totals).toEqual({ total: 1000, idle: 850 });
	});

	it("rejects a file whose first line is not the aggregate cpu line", () => {
		expect(parseCpuTotals("cpu0 1 2 3 4 5\n")).toBeNull();
		expect(parseCpuTotals("")).toBeNull();
		expect(parseCpuTotals("cpu  1 2 3\n")).toBeNull();
		expect(parseCpuTotals("cpu  1 2 x 4 5\n")).toBeNull();
	});
});

describe("cpuBusyPercent", () => {
	it("reports the busy share of the window", () => {
		// A 1000-jiffy window with 850 idle jiffies is 15% busy.
		expect(cpuBusyPercent(1000, 850)).toBe("15.0");
	});

	it("returns N/A for an empty window instead of dividing by zero", () => {
		expect(cpuBusyPercent(0, 0)).toBe("N/A");
		expect(cpuBusyPercent(-5, 0)).toBe("N/A");
	});

	it("clamps a counter that ran backwards", () => {
		expect(cpuBusyPercent(100, 500)).toBe("0.0");
		expect(cpuBusyPercent(100, -500)).toBe("100.0");
	});
});

/** utime=field 14, stime=15, starttime=22, rss=24 — counted after the last `)`. */
function statLine(overrides: { comm?: string; utime?: number; stime?: number; startTicks?: number; rss?: number } = {}) {
	const { comm = "node", utime = 0, stime = 0, startTicks = 0, rss = 0 } = overrides;
	// Index 0 is the state field, i.e. field 3 of the line — the same offset the
	// parser sees after slicing past the last `)`.
	const fields = Array.from({ length: 22 }, () => "0");
	fields[0] = "S";
	fields[11] = String(utime);
	fields[12] = String(stime);
	fields[19] = String(startTicks);
	fields[21] = String(rss);
	return `123 (${comm}) ${fields.join(" ")}`;
}

describe("parseProcessStat", () => {
	it("measures CPU over the process's own lifetime, not the host uptime", () => {
		// Started 1000s into a 1100s uptime, so its own lifetime is 100s: 50s of
		// CPU on an 8-core box is 6.25% of the host. Dividing by the full 1100s
		// uptime — what the old formula did — reported 0.6% for the same process.
		const parsed = parseProcessStat(
			statLine({ utime: 4000, stime: 1000, startTicks: 100_000, rss: 256 }),
			1100,
			8,
		);
		expect(parsed?.cpuPercent).toBeCloseTo(6.25, 5);
		expect(parsed?.memKb).toBe(1024);
		expect(parsed?.cmd).toBe("node");
	});

	it("clamps a multi-threaded process to the whole host", () => {
		const parsed = parseProcessStat(
			statLine({ utime: 100_000, stime: 0, startTicks: 0, rss: 0 }),
			100,
			2,
		);
		expect(parsed?.cpuPercent).toBe(100);
	});

	it("counts fields from the last paren so a comm with spaces still parses", () => {
		const parsed = parseProcessStat(
			statLine({ comm: "my app (worker)", rss: 4 }),
			10,
			1,
		);
		expect(parsed?.cmd).toBe("my app (worker)");
		expect(parsed?.memKb).toBe(16);
	});

	it("rejects a truncated or unparseable line", () => {
		expect(parseProcessStat("123 (node) S 1 2 3", 10, 1)).toBeNull();
		expect(parseProcessStat("no parens here", 10, 1)).toBeNull();
		const withText = statLine().replace(/ 0$/, " notanumber");
		expect(parseProcessStat(withText, 10, 1)).toBeNull();
	});
});

describe("countEstablishedSockets", () => {
	const table = [
		"  sl  local_address rem_address   st tx_queue rx_queue",
		"   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000",
		"   1: 0100007F:1F90 0100007F:C001 01 00000000:00000000",
		"   2: 0100007F:1F90 0100007F:C002 01 00000000:00000000",
		"",
	].join("\n");

	it("counts only state 01 and skips the header", () => {
		expect(countEstablishedSockets(table)).toBe(2);
	});

	it("returns 0 for a table that could not be read", () => {
		// readProc yields "" when /proc/net/tcp6 is absent (IPv6 disabled).
		expect(countEstablishedSockets("")).toBe(0);
	});
});
