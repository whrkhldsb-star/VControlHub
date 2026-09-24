/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { lookupMock, agentInstances, undiciFetchMock } = vi.hoisted(() => ({
	lookupMock: vi.fn(),
	agentInstances: [] as Array<{ options: unknown; destroyed: boolean }>,
	undiciFetchMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
	lookup: lookupMock,
	default: { lookup: lookupMock },
}));

vi.mock("undici", () => ({
	Agent: class FakeAgent {
		options: unknown;
		destroyed = false;
		constructor(options: unknown) {
			this.options = options;
			agentInstances.push(this);
		}
		destroy() {
			this.destroyed = true;
			return Promise.resolve();
		}
	},
	fetch: undiciFetchMock,
}));

import { fetchWithPinnedDns } from "../pinned-fetch";

type ConnectLookupFn = (
	hostname: string,
	options: unknown,
	callback: (err: Error | null, address?: unknown, family?: unknown) => void,
) => void;

function agentConnectLookup(): ConnectLookupFn | undefined {
	const agent = agentInstances.at(-1);
	const connect = (agent?.options as { connect?: { lookup?: unknown } } | undefined)?.connect;
	return connect?.lookup as ConnectLookupFn | undefined;
}

describe("fetchWithPinnedDns", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		agentInstances.length = 0;
	});

	it("pins the verified address in the connect lookup", async () => {
		lookupMock.mockResolvedValue([
			{ address: "203.0.113.10", family: 4 },
			{ address: "198.51.100.20", family: 4 },
		]);
		undiciFetchMock.mockResolvedValue(new Response("ok"));

		await fetchWithPinnedDns("https://api.example.com/v1/models", { method: "GET" });

		const lookup = agentConnectLookup()!;
		expect(lookup).toBeTypeOf("function");
		// Single-address form pins the first verified address.
		let cbResult: unknown;
		lookup("api.example.com", {}, (err, address, family) => {
			cbResult = { err, address, family };
		});
		expect(cbResult).toEqual({ err: null, address: "203.0.113.10", family: 4 });
		// all:true form returns the full validated set — no unverified address
		// can appear, and net keeps its multi-address failover.
		lookup("api.example.com", { all: true }, (err, entries) => {
			cbResult = { err, entries };
		});
		expect(cbResult).toEqual({
			err: null,
			entries: [
				{ address: "203.0.113.10", family: 4 },
				{ address: "198.51.100.20", family: 4 },
			],
		});
	});

	it("refuses a connect-time lookup for any other host (redirect rebind)", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		undiciFetchMock.mockResolvedValue(new Response("ok"));

		await fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" });

		const lookup = agentConnectLookup()!;
		let captured: unknown;
		lookup("rebind.example.net", {}, (err) => {
			captured = err;
		});
		expect(captured).toBeInstanceOf(Error);
		expect((captured as Error).message).toMatch(/mismatch/i);
	});

	it("rejects resolutions containing blocked addresses before connecting", async () => {
		lookupMock.mockResolvedValue([
			{ address: "203.0.113.10", family: 4 },
			{ address: "169.254.169.254", family: 4 },
		]);

		await expect(
			fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" }),
		).rejects.toThrow(/non-public/);
		expect(undiciFetchMock).not.toHaveBeenCalled();
	});

	it("rejects loopback and link-local unicast pins", async () => {
		lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
		await expect(
			fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" }),
		).rejects.toThrow(/non-public/);

		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(
			fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" }),
		).rejects.toThrow(/non-public/);
		expect(undiciFetchMock).not.toHaveBeenCalled();
	});

	it("rejects empty DNS answers", async () => {
		lookupMock.mockResolvedValue([]);
		await expect(
			fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" }),
		).rejects.toThrow(/non-public/);
	});

	it("destroys the dispatcher once the response body ends", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		undiciFetchMock.mockResolvedValue(new Response("chunk", { status: 200 }));

		const response = await fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" });
		const agent = agentInstances.at(-1)!;
		expect(agent.destroyed).toBe(false);
		const text = await response.text();
		expect(text).toBe("chunk");
		expect(agent.destroyed).toBe(true);
	});

	it("destroys the dispatcher when the body read fails", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		const upstreamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("upstream reset"));
			},
		});
		undiciFetchMock.mockResolvedValue(new Response(upstreamBody, { status: 200 }));

		const response = await fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" });
		await expect(response.text()).rejects.toThrow(/upstream reset/);
		expect(agentInstances.at(-1)!.destroyed).toBe(true);
	});

	it("destroys the dispatcher when the fetch itself fails", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		undiciFetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

		await expect(
			fetchWithPinnedDns("https://api.example.com/v1", { method: "GET" }),
		).rejects.toThrow(/ECONNREFUSED/);
		expect(agentInstances.at(-1)!.destroyed).toBe(true);
	});

	it("disposes immediately for bodiless responses", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		undiciFetchMock.mockResolvedValue(new Response(null, { status: 204 }));

		const response = await fetchWithPinnedDns("https://api.example.com/v1", { method: "HEAD" });
		expect(response.status).toBe(204);
		expect(agentInstances.at(-1)!.destroyed).toBe(true);
	});
});
