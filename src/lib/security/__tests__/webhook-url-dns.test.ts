import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));

import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { assertWebhookUrlSafeForServerFetch, fetchWebhookSafely } from "../webhook-url";

describe("a webhook host that resolves where it must not", () => {
	// Braces matter: a function returned from beforeEach is run as its teardown.
	beforeEach(() => {
		lookupMock.mockReset();
	});

	it("is refused before any request, with the reason in the caller's language", async () => {
		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x")).resolves.toEqual({ ok: false, error: "Webhook URL 的域名解析到了本机或内网地址" });
		await expect(withApiCopyLocale("en", () => assertWebhookUrlSafeForServerFetch("https://hooks.example.com/x"))).resolves.toEqual({
			ok: false,
			error: "The webhook URL's host resolves to a local or private address",
		});
		await expect(fetchWebhookSafely("https://hooks.example.com/x", { method: "POST" })).resolves.toEqual({ ok: false, error: "Webhook URL 的域名解析到了本机或内网地址" });
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
