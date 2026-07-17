import { beforeEach, describe, expect, it, vi } from "vitest";

const { execRemoteCommandMock, buildSshParamsFromServerMock, prismaMock } = vi.hoisted(() => ({
	execRemoteCommandMock: vi.fn(),
	buildSshParamsFromServerMock: vi.fn(),
	prismaMock: {
		server: {
			findUnique: vi.fn(),
		},
	},
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ssh/client", () => ({
	execRemoteCommand: execRemoteCommandMock,
	buildSshParamsFromServer: buildSshParamsFromServerMock,
}));

import { collectServerMetrics, parseMonitorScriptOutput } from "../monitor";

describe("parseMonitorScriptOutput", () => {
	it("parses compact agentless SSH monitor output", () => {
		const output = [
			"===CPU===",
			"4",
			"0.12 0.34 0.56 1/200 12345",
			"73 100",
			"===MEM===",
			"16000 6000 9000",
			"===SWAP===",
			"2048 512",
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
		expect(result.swapUsagePercent).toBe(25);
		expect(result.disk).toEqual([{ mount: "/", totalGb: "40G", usedGb: "10G", usagePercent: 25 }]);
		expect(result.network).toEqual([{ iface: "eth0", rxBytes: 1234, txBytes: 5678 }]);
	});

	it("omits swapUsagePercent when host has no swap", () => {
		const output = [
			"===CPU===",
			"2",
			"0.01 0.02 0.03 1/100 1",
			"90 100",
			"===MEM===",
			"8000 2000 6000",
			"===SWAP===",
			"0 0",
			"===DISK===",
			"20G 5G 25% /",
			"===LOAD===",
			"up 1 day, 1 user, load average: 0.01, 0.02, 0.03",
			"===NET===",
			"eth0 100 200",
		].join("\n");

		const result = parseMonitorScriptOutput(output);
		expect(result.swapUsagePercent).toBeUndefined();
	});
});

describe("collectServerMetrics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns an offline error instead of throwing when stored credentials cannot be decrypted", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_1",
			host: "203.0.113.10",
			port: 22,
			username: "root",
			enabled: true,
			password: "enc:v1:old-ciphertext",
			sshKeyId: null,
			sshKey: null,
		});
		buildSshParamsFromServerMock.mockRejectedValueOnce(new Error("Unsupported state or unable to authenticate data"));

		const result = await collectServerMetrics("server_1");

		expect(result).toEqual({
			serverId: "server_1",
			error: "Connection failed: Unsupported state or unable to authenticate data",
		});
		expect(execRemoteCommandMock).not.toHaveBeenCalled();
	});
});
