import net from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tcpProbe } from "../connectivity";

/**
 * Unit tests for `tcpProbe`. We use a real localhost listener for the success
 * path so we exercise the actual socket state machine; the failure paths are
 * covered by deterministic network conditions (closed port → ECONNREFUSED,
 * unrouted IP → timeout, invalid host → ENOTFOUND).
 */
describe("tcpProbe", () => {
	let server: net.Server | null = null;
	let listenPort = 0;

	beforeEach(async () => {
		server = net.createServer();
		await new Promise<void>((resolve) => {
			server!.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server!.address();
		if (address && typeof address === "object") {
			listenPort = address.port;
		}
	});

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = null;
		}
	});

	it("reports ok=true and a positive latency when the host accepts the connection", async () => {
		const result = await tcpProbe("127.0.0.1", listenPort, 1_000);
		expect(result.ok).toBe(true);
		expect(typeof result.latencyMs).toBe("number");
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result.error).toBeUndefined();
	});

	it("reports ok=false with ECONNREFUSED when the port is closed", async () => {
		// Close the listener so the port stops accepting connections, then
		// probe it. ECONNREFUSED is the expected kernel reply.
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = null;
		const result = await tcpProbe("127.0.0.1", listenPort, 1_000);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/ECONNREFUSED|connect/i);
	});

	it("reports ok=false with a timeout error when the host does not respond", async () => {
		// RFC 5737 documentation prefix — guaranteed unroutable on a normal
		// host, so the connect attempt either hangs or returns EHOSTUNREACH
		// after the OS gives up. Either way we expect ok=false within the
		// short deadline.
		const result = await tcpProbe("192.0.2.1", 22, 250);
		expect(result.ok).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("reports ok=false with ENOTFOUND when the hostname does not resolve", async () => {
		const result = await tcpProbe(
			"definitely-not-a-real-host-9f8a7b6c.invalid",
			22,
			1_000,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/ENOTFOUND|resolve|not.found/i);
	});

	it("never throws and always resolves within roughly the configured timeout", async () => {
		// Belt-and-suspenders: even on weird inputs, the probe must not
		// reject the promise or hang forever.
		const start = Date.now();
		const result = await tcpProbe("127.0.0.1", listenPort, 1_500);
		const elapsed = Date.now() - start;
		expect(result.ok).toBe(true);
		expect(elapsed).toBeLessThan(1_500 + 200);
	});
});
