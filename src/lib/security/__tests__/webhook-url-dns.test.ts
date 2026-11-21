import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock, fetchMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), fetchMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));
vi.mock("undici", async (original) => ({ ...await original<typeof import("undici")>(), fetch: fetchMock }));

import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { assertWebhookUrlSafeForServerFetch, fetchWebhookSafely, validateWebhookUrlSyntax } from "../webhook-url";

describe("a webhook host that resolves where it must not", () => {
	// Braces matter: a function returned from beforeEach is run as its teardown.
	beforeEach(() => {
		lookupMock.mockReset();
		fetchMock.mockReset();
	});

	it("is refused before any request, with the reason in the caller's language", async () => {
		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x")).resolves.toEqual({ ok: false, error: "Webhook URL 的域名解析到了本机或内网地址" });
		await expect(withApiCopyLocale("en", () => assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x"))).resolves.toEqual({
			ok: false,
			error: "The webhook URL's host resolves to a local or private address",
		});
		await expect(fetchWebhookSafely("https://hooks.example.com/x", { method: "POST" })).resolves.toEqual({
			ok: false, dispatched: false, error: "Webhook URL 的域名解析到了本机或内网地址",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("checks public and private IPv6 literals consistently without querying DNS", async () => {
		const publicUrl = "https://[2001:4860:4860::8888]:8443/hook";
		expect(validateWebhookUrlSyntax(publicUrl)).toEqual({ ok: true, url: publicUrl });
		await expect(assertWebhookUrlSafeForServerFetch(publicUrl)).resolves.toEqual({ ok: true, url: publicUrl });
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		await expect(fetchWebhookSafely(publicUrl, { method: "POST" })).resolves.toMatchObject({ ok: true, response: { status: 204 } });
		expect(fetchMock).toHaveBeenCalledWith(publicUrl, expect.objectContaining({ redirect: "error" }));

		const privateUrl = "https://[fd00::1]/hook";
		expect(validateWebhookUrlSyntax(privateUrl).ok).toBe(false);
		await expect(assertWebhookUrlSafeForServerFetch(privateUrl)).resolves.toMatchObject({ ok: false });
		await expect(fetchWebhookSafely(privateUrl, { method: "POST" })).resolves.toMatchObject({ ok: false, dispatched: false });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(lookupMock).not.toHaveBeenCalled();
	});

	it.each(["request", "body"])("classifies a broken %s after dispatch as an unknown delivery", async (stage) => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.30", family: 4 }]);
		const fault = new Error("transport failed with a secret");
		if (stage === "request") fetchMock.mockRejectedValue(fault);
		else fetchMock.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(fault); } })));
		await expect(fetchWebhookSafely("https://hooks.example.com/x", { method: "POST", failOnBodyReadError: true }))
			.resolves.toEqual({ ok: false, dispatched: true, error: "Webhook request failed" });
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(lookupMock).toHaveBeenCalledOnce();
	});

	it("says so when the host does not resolve at all", async () => {
		lookupMock.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
		await expect(assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x")).resolves.toEqual({ ok: false, error: "Webhook URL 的域名解析失败" });
		await expect(withApiCopyLocale("en", () => assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x"))).resolves.toEqual({
			ok: false,
			error: "The webhook URL's host could not be resolved",
		});
	});
});

it.each(["64:ff9b::1234", "64:ff9b:1::42", "2002::1", "2001:0000::1", "2001:0db8::1", "3fff::1"])(
	"uses the same transition-address policy for literals and DNS answers (%s)", async (address) => {
		expect(validateWebhookUrlSyntax(`https://[${address}]/`).ok).toBe(false);
		lookupMock.mockResolvedValue([{ address, family: 6 }]);
		expect((await assertWebhookUrlSafeForServerFetch("https://hooks.example.com")).ok).toBe(false);
	},
);

it("ends a webhook cancelled during lookup before dispatch", async () => {
	const dns = Promise.withResolvers<never[]>();
	lookupMock.mockReturnValue(dns.promise);
	const controller = new AbortController();
	const result = fetchWebhookSafely("https://hooks.example.com", { method: "POST", signal: controller.signal });
	controller.abort();
	await expect(result).resolves.toMatchObject({ ok: false, dispatched: false });
	dns.resolve([]);
});

it("starts the delivery deadline before lookup even without a caller-supplied signal", async () => {
	const dns = Promise.withResolvers<never[]>();
	lookupMock.mockClear().mockReturnValue(dns.promise);
	fetchMock.mockClear();
	const deadline = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
	try {
		const delivery = fetchWebhookSafely("https://hooks.example.com", { method: "POST" });
		expect(timeout).toHaveBeenCalledWith(15_000);
		expect(lookupMock).toHaveBeenCalledOnce();
		deadline.abort();
		await expect(delivery).resolves.toMatchObject({ ok: false, dispatched: false });
		expect(fetchMock).not.toHaveBeenCalled();
	} finally {
		dns.resolve([]);
		timeout.mockRestore();
	}
});
