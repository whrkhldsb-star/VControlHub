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

import { fetchWebhookSafely } from "../webhook-url";
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

	it("pins every verified webhook address for multi-address lookup", async () => {
		const records = [{ address: "192.0.78.24", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }];
		lookupMock.mockResolvedValue(records);
		undiciFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		expect((await fetchWebhookSafely("https://hooks.example/test", { method: "POST" })).ok).toBe(true);
		const cb = vi.fn();
		agentConnectLookup()!("hooks.example", { all: true }, cb);
		expect(cb).toHaveBeenCalledWith(null, records, undefined);
		agentConnectLookup()!("hooks.example", {}, cb);
		expect(cb).toHaveBeenLastCalledWith(null, records[0]!.address, 4);
		expect(lookupMock).toHaveBeenCalledTimes(1);
	});

	it("verifies certificates unless a status-only probe asks otherwise, and stays pinned either way", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		undiciFetchMock.mockImplementation(async () => new Response("ok"));

		await fetchWithPinnedDns("https://203.0.113.10/__vch_health", { method: "GET" });
		expect((agentInstances.at(-1)?.options as { connect: Record<string, unknown> }).connect).not.toHaveProperty("rejectUnauthorized");

		// The direct gateway on a bare IP serves a self-signed certificate by design.
		await fetchWithPinnedDns("https://203.0.113.10/__vch_health", { method: "GET" }, { allowUntrustedCertificate: true });
		expect((agentInstances.at(-1)?.options as { connect: Record<string, unknown> }).connect.rejectUnauthorized).toBe(false);
		expect(agentConnectLookup()).toBeTypeOf("function");
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

	// A host the operator listed (AI_PROVIDER_PRIVATE_HOSTS) may be on a private network; metadata never.
	it("connects to a private address only when asked, and never to a link-local one", async () => {
		undiciFetchMock.mockResolvedValue({ status: 200, statusText: "OK", headers: new Map(), body: null });
		lookupMock.mockResolvedValue([{ address: "192.168.1.20", family: 4 }]);
		await expect(fetchWithPinnedDns("http://ollama.lan:11434/v1", { method: "GET" })).rejects.toThrow(/non-public/);
		await expect(fetchWithPinnedDns("http://ollama.lan:11434/v1", { method: "GET" }, { allowPrivateAddress: true })).resolves.toMatchObject({ status: 200 });

		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(fetchWithPinnedDns("http://ollama.lan/v1", { method: "GET" }, { allowPrivateAddress: true })).rejects.toThrow(/non-public/);
		lookupMock.mockResolvedValue([{ address: "fe80::1", family: 6 }]);
		await expect(fetchWithPinnedDns("http://ollama.lan/v1", { method: "GET" }, { allowPrivateAddress: true })).rejects.toThrow(/non-public/);
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

it.each(["::ffff:a9fe:1234", "::a9fe:1234", "fd00:0ec2:0:0:0:0:0:0254", "64:ff9b::a9fe:1"])(
	"applies private-provider exclusions to DNS and canonical URL literals (%s)", async (address) => {
		lookupMock.mockResolvedValue([{ address, family: 6 }]);
		for (const host of ["provider.test", `[${address}]`]) {
			await expect(fetchWithPinnedDns(`https://${host}/`, {}, { allowPrivateAddress: true })).rejects.toThrow(/non-public/);
		}
	},
);

it("keeps outstanding DNS calls bounded when many callers cancel", async () => {
	const dns = Promise.withResolvers<never[]>();
	lookupMock.mockClear().mockReturnValue(dns.promise);
	for (let i = 0; i < 64; i++) {
		const controller = new AbortController();
		const result = fetchWithPinnedDns("https://provider.test", { signal: controller.signal });
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	}
	await expect(fetchWithPinnedDns("https://provider.test", {})).rejects.toThrow(/pending DNS/);
	expect(lookupMock).toHaveBeenCalledTimes(64);
	dns.resolve([]);
	await Promise.resolve();
	await Promise.resolve();
	lookupMock.mockResolvedValue([{ address: "10.1.1.1", family: 4 }]);
	await expect(fetchWithPinnedDns("https://provider.test", {})).rejects.toThrow(/non-public/);
});

it("skips DNS for a bracketed public IPv6 direct-access URL", async () => {
	const { assertPublicBaseUrlResolvesPublic } = await import("@/lib/storage/direct-access-url");
	lookupMock.mockClear();
	const url = "https://[2606:4700:4700::1111]:8443";
	await expect(assertPublicBaseUrlResolvesPublic(url)).resolves.toBe(url);
	await expect(assertPublicBaseUrlResolvesPublic("https://[fe80::1]")).rejects.toThrow();
	expect(lookupMock).not.toHaveBeenCalled();
});
