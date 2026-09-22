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


vi.mock("@/lib/i18n/server-locale-cookie", () => ({
	getServerLocale: async () => "en" as const,
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

	it("uses fresh Agent metrics without opening an SSH session", async () => {
		const raw = [
			"===CPU===", "2", "0.01 0.02 0.03 1/100 1", "10 100",
			"===MEM===", "8000 2000 6000", "===SWAP===", "0 0",
			"===DISK===", "20G 5G 25% /", "===LOAD===", "up 1 day, 1 user, load average: 0.01, 0.02, 0.03",
			"===NET===", "eth0 100 200",
		].join("\n");
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_agent",
			enabled: true,
			managementMode: "AGENT",
			agentMetricsRaw: raw,
			agentMetricsAt: new Date(),
		});

		const result = await collectServerMetrics("server_agent");

		expect(result).toMatchObject({ cpu: { usagePercent: 90 }, network: [{ iface: "eth0" }] });
		expect(execRemoteCommandMock).not.toHaveBeenCalled();
	});

	it("parses the Windows agent's ===SECTION=== payload (no loadavg, no users in uptime, drive-letter mounts)", async () => {
		// Exact shape emitted by buildAgentPowerShell's Get-AgentMetrics.
		const raw = [
			"===CPU===", "8", "0 0 0", "37.5 100",
			"===MEM===", "32695 20123 12572", "===SWAP===", "0 0",
			"===DISK===", "100G 50G 50 C:", "===LOAD===", "up 3 days, 2:07",
			"===NET===", "Ethernet 3212 1123",
		].join("\n");
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_win_agent",
			enabled: true,
			operatingSystem: "WINDOWS",
			managementMode: "AGENT",
			agentMetricsRaw: raw,
			agentMetricsAt: new Date(),
		});

		const result = await collectServerMetrics("server_win_agent");

		expect(result).toMatchObject({
			cpu: { usagePercent: 62.5, cores: 8, loadAvg: [0, 0, 0] },
			memory: { totalMb: 32695, usedMb: 20123, availableMb: 12572, usagePercent: 61.5 },
			disk: [{ mount: "C:", totalGb: "100G", usedGb: "50G", usagePercent: 50 }],
			network: [{ iface: "Ethernet", rxBytes: 3212, txBytes: 1123 }],
			uptime: "up 3 days, 2:07",
		});
		expect(execRemoteCommandMock).not.toHaveBeenCalled();
	});

	it("reports the agent as offline for a Windows AGENT node with stale metrics instead of attempting SSH", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_win_stale",
			enabled: true,
			operatingSystem: "WINDOWS",
			managementMode: "AGENT",
			agentMetricsRaw: "===CPU===",
			agentMetricsAt: new Date(Date.now() - 10 * 60_000),
		});

		const result = await collectServerMetrics("server_win_stale");

		// Windows has no SSH fallback channel; the error must say so rather than
		// surfacing buildSshParamsFromServer's "Linux only" rejection.
		expect(result).toEqual({
			serverId: "server_win_stale",
			error: "Agent is offline and no SSH fallback credential is configured",
		});
		expect(buildSshParamsFromServerMock).not.toHaveBeenCalled();
		expect(execRemoteCommandMock).not.toHaveBeenCalled();
	});

	it("keeps rejecting monitoring for DIRECT-mode Windows nodes (RDP only, no agent)", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_win_direct",
			enabled: true,
			operatingSystem: "WINDOWS",
			managementMode: "DIRECT",
		});

		const result = await collectServerMetrics("server_win_direct");

		expect(result).toEqual({ serverId: "server_win_direct", error: "This operation supports Linux nodes only" });
		expect(buildSshParamsFromServerMock).not.toHaveBeenCalled();
	});

	it("reports metrics unavailable instead of a false-healthy all-zero reading when SSH output is truncated", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_trunc",
			host: "203.0.113.20",
			port: 22,
			username: "root",
			enabled: true,
			managementMode: "DIRECT",
			password: null,
			sshKeyId: null,
			sshKey: null,
		});
		buildSshParamsFromServerMock.mockResolvedValueOnce({ host: "203.0.113.20", port: 22, username: "root" });
		// SSH answered (exitCode 0) but the monitor payload was cut off — no
		// section markers, so every parse helper would fall back to 0.
		execRemoteCommandMock.mockResolvedValueOnce({ stdout: "bash: /proc: Permission denied", exitCode: 0 });

		const result = await collectServerMetrics("server_trunc");

		expect(result).toEqual({
			serverId: "server_trunc",
			error: "Monitoring data unavailable (SSH reachable but no valid /proc metrics returned)",
		});
	});

	it("reports metrics unavailable when MemTotal parses to zero (unreadable /proc/meminfo)", async () => {
		prismaMock.server.findUnique.mockResolvedValueOnce({
			id: "server_nomem",
			host: "203.0.113.21",
			port: 22,
			username: "root",
			enabled: true,
			managementMode: "DIRECT",
			password: null,
			sshKeyId: null,
			sshKey: null,
		});
		buildSshParamsFromServerMock.mockResolvedValueOnce({ host: "203.0.113.21", port: 22, username: "root" });
		// Markers present but the MEM awk fallback fired (meminfo unreadable) →
		// totalMb 0. Do not fabricate a healthy 0% memory reading.
		const raw = [
			"===CPU===", "4", "0.1 0.2 0.3", "50 100",
			"===MEM===", "0 0 0", "===SWAP===", "0 0",
			"===DISK===", "40G 10G 25% /", "===LOAD===", "up 1 day, 1 user",
			"===NET===", "eth0 1 2",
		].join("\n");
		execRemoteCommandMock.mockResolvedValueOnce({ stdout: raw, exitCode: 0 });

		const result = await collectServerMetrics("server_nomem");

		expect(result).toEqual({
			serverId: "server_nomem",
			error: "Monitoring data unavailable (SSH reachable but no valid /proc metrics returned)",
		});
	});
});
