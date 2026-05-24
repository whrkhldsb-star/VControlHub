import { describe, expect, it } from "vitest";

import { parseMonitorScriptOutput } from "../monitor";

describe("parseMonitorScriptOutput", () => {
	it("parses compact agentless SSH monitor output", () => {
		const output = [
			"===CPU===",
			"4",
			"0.12 0.34 0.56 1/200 12345",
			"73 100",
			"===MEM===",
			"16000 6000 9000",
			"===DISK===",
			"40G 10G 25% /",
			"===LOAD===",
			"up 3 days, 2 users, load average: 0.12, 0.34, 0.56",
			"===NET===",
			"eth0 1234 5678",
		].join("\n");

		const result = parseMonitorScriptOutput(output);

		expect(result.cpu).toEqual({ usagePercent: 27, cores: 4, loadAvg: [0.12, 0.34, 0.56] });
		expect(result.memory.usagePercent).toBe(37.5);
		expect(result.disk).toEqual([{ mount: "/", totalGb: "40G", usedGb: "10G", usagePercent: 25 }]);
		expect(result.network).toEqual([{ iface: "eth0", rxBytes: 1234, txBytes: 5678 }]);
	});
});
