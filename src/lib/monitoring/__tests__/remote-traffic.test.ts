/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the two fan-out guarantees of sampleRemoteServersTraffic:
 *   - concurrent SSH sessions are chunked, not one-per-server all at once
 *     (the /traffic route selects `take: 200`, so unbounded meant 200 handshakes)
 *   - the previous-sample cache evicts entries that stopped being refreshed,
 *     so deleted servers and vanished interfaces do not accumulate forever
 */

const mocks = vi.hoisted(() => ({
	execRemoteCommand: vi.fn(),
	// Echo the server's own host so a per-host mock implementation below can tell
	// the sessions apart (a fixed host made every call look like the same server).
	buildSshParamsFromServer: vi.fn(async (server: { host: string; port: number; username: string }) => ({
		host: server.host,
		port: server.port,
		username: server.username,
	})),
}));

vi.mock("@/lib/ssh/client", () => ({
	execRemoteCommand: mocks.execRemoteCommand,
	buildSshParamsFromServer: mocks.buildSshParamsFromServer,
}));

vi.mock("@/lib/i18n/service-translations", () => ({
	t: (key: string) => key,
}));

const { sampleRemoteServersTraffic, __resetRemoteTrafficCache } = await import(
	"../remote-traffic"
);

function procNetDev(rxBytes: number, txBytes: number): string {
	return [
		"Inter-|   Receive                                                |  Transmit",
		" face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets",
		`    eth0: ${rxBytes} 10 0 0 0 0 0 0 ${txBytes} 20 0 0 0 0 0 0`,
	].join("\n");
}

function serverInput(id: string) {
	return {
		id,
		name: `node-${id}`,
		host: `10.0.0.${id.replace(/\D/g, "") || "1"}`,
		port: 22,
		username: "root",
		sshKeyId: "key_1",
		password: null,
		sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
	};
}

describe("sampleRemoteServersTraffic", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		__resetRemoteTrafficCache();
	});

	it("caps concurrent SSH sessions at 5 instead of opening one per server", async () => {
		let inFlight = 0;
		let peakInFlight = 0;
		mocks.execRemoteCommand.mockImplementation(async () => {
			inFlight += 1;
			peakInFlight = Math.max(peakInFlight, inFlight);
			// Yield so every started session in this chunk overlaps before any resolves.
			await new Promise((resolve) => setImmediate(resolve));
			inFlight -= 1;
			return { stdout: procNetDev(1000, 2000), stderr: "", exitCode: 0 };
		});

		const servers = Array.from({ length: 20 }, (_, index) => serverInput(`srv${index}`));
		const results = await sampleRemoteServersTraffic(servers);

		expect(results).toHaveLength(20);
		expect(mocks.execRemoteCommand).toHaveBeenCalledTimes(20);
		expect(peakInFlight).toBeLessThanOrEqual(5);
		// Guard against the chunking silently degrading to fully sequential.
		expect(peakInFlight).toBeGreaterThan(1);
	});

	it("keeps every server's own result at its own index when one server fails", async () => {
		mocks.execRemoteCommand.mockImplementation(async (input: { host: string }) => {
			if (input.host.endsWith(".2")) throw new Error("host unreachable");
			return { stdout: procNetDev(500, 700), stderr: "", exitCode: 0 };
		});

		const results = await sampleRemoteServersTraffic([
			serverInput("srv1"),
			serverInput("srv2"),
			serverInput("srv3"),
		]);

		expect(results.map((row) => row.serverId)).toEqual(["srv1", "srv2", "srv3"]);
		expect(results[0]?.error).toBeNull();
		expect(results[1]?.error).toContain("connectionFailed");
		expect(results[2]?.error).toBeNull();
	});

	it("computes a rate against the previous sample on the second run", async () => {
		mocks.execRemoteCommand
			.mockResolvedValueOnce({ stdout: procNetDev(1_000, 2_000), stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ stdout: procNetDev(11_000, 22_000), stderr: "", exitCode: 0 });

		const first = await sampleRemoteServersTraffic([serverInput("srv1")]);
		// First poll has no baseline, so the rate is 0 by definition.
		expect(first[0]?.primaryInterface?.rxRateBytesPerSecond).toBe(0);

		await new Promise((resolve) => setTimeout(resolve, 1100));
		const second = await sampleRemoteServersTraffic([serverInput("srv1")]);
		expect(second[0]?.primaryInterface?.rxRateBytesPerSecond).toBeGreaterThan(0);
	});

	it("evicts a cached counter once it is older than the TTL, so a deleted server stops holding memory", async () => {
		mocks.execRemoteCommand.mockResolvedValue({
			stdout: procNetDev(1_000, 2_000),
			stderr: "",
			exitCode: 0,
		});

		// srv_gone gets a baseline, then disappears from the fleet.
		await sampleRemoteServersTraffic([serverInput("srv_gone")]);

		// Jump past PREVIOUS_SAMPLE_TTL_MS (1h) so the next run's eviction sweep
		// sees srv_gone's entry as stale. srv_live is what keeps the run going.
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
		await sampleRemoteServersTraffic([serverInput("srv_live")]);
		vi.useRealTimers();

		// srv_gone's baseline is gone: coming back reads as a first poll (rate 0)
		// rather than diffing against an hours-old counter.
		mocks.execRemoteCommand.mockResolvedValue({
			stdout: procNetDev(9_000_000, 9_000_000),
			stderr: "",
			exitCode: 0,
		});
		const revived = await sampleRemoteServersTraffic([serverInput("srv_gone")]);
		expect(revived[0]?.primaryInterface?.rxRateBytesPerSecond).toBe(0);
	});
});
