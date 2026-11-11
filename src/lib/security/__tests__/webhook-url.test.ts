import { describe, expect, it } from "vitest";
import { withApiCopyLocale } from "@/lib/i18n/api-copy";
import { detachWebhookResponse, validateWebhookUrlSyntax } from "../webhook-url";

describe("webhook URL safety validation", () => {
	it("allows normal HTTPS webhook endpoints", () => {
		expect(validateWebhookUrlSyntax("https://hooks.example.com/services/abc")).toEqual({
			ok: true,
			url: "https://hooks.example.com/services/abc",
		});
	});

	it("rejects localhost, private, metadata, and IPv4-mapped internal addresses", () => {
		const blocked = [
			"http://hooks.example.com/services/abc",
			"https://user:pass@hooks.example.com/services/abc",
			"https://localhost/hook",
			"https://127.0.0.1/hook",
			"https://10.0.0.1/hook",
			"https://172.16.0.1/hook",
			"https://192.168.1.2/hook",
			"https://169.254.169.254/latest/meta-data/",
			"https://[::1]/hook",
			"https://[fe80::1]/hook",
			"https://[fc00::1]/hook",
			"https://[fd00::1]/hook",
			"https://[::ffff:127.0.0.1]/hook",
			"https://[::ffff:7f00:1]/hook",
			// Deprecated IPv4-compatible form (::a.b.c.d) must also be blocked.
			"https://[::127.0.0.1]/hook",
			"https://[::169.254.169.254]/hook",
			"https://[::a9fe:a9fe]/hook",
		];

		for (const url of blocked) {
			expect(validateWebhookUrlSyntax(url), url).toMatchObject({ ok: false });
		}
	});
});

describe("why a webhook URL is refused", () => {
	// Shown when an alert rule, an ITSM connection, a playbook step or a WebDAV
	// endpoint is saved, and kept as the reason a delivery failed: six fixed
	// English sentences, whatever language the page was in.
	it.each([
		["not a url", "Webhook URL 格式无效", "The webhook URL is not a valid URL"],
		["http://hooks.example.com/x", "Webhook URL 必须使用 https://", "The webhook URL must use https://"],
		["https://user:pass@hooks.example.com/x", "Webhook URL 不能包含用户名或密码", "The webhook URL must not contain a username or password"],
		["https://localhost/hook", "Webhook URL 不能指向本机或内网地址", "The webhook URL must not point to a local or private address"],
		["https://10.0.0.1/hook", "Webhook URL 不能指向本机或内网地址", "The webhook URL must not point to a local or private address"],
		["https://db.internal/hook", "Webhook URL 不能指向内部域名", "The webhook URL must not point to an internal domain"],
	])("%s", (url, chinese, english) => {
		expect(validateWebhookUrlSyntax(url)).toEqual({ ok: false, error: chinese });
		expect(withApiCopyLocale("en", () => validateWebhookUrlSyntax(url))).toEqual({ ok: false, error: english });
	});
});

describe("detachWebhookResponse", () => {
	it("preserves status and headers while fully draining the body", async () => {
		const source = new Response("pong", {
			status: 202,
			statusText: "Accepted",
			headers: { "X-Trace": "abc" },
		});

		const detached = await detachWebhookResponse(source);

		expect(detached.status).toBe(202);
		expect(detached.headers.get("x-trace")).toBe("abc");
		expect(await detached.text()).toBe("pong");
		// The upstream body must be consumed so the dispatcher can be destroyed.
		expect(source.bodyUsed || source.body?.locked).toBeTruthy();
	});

	it("truncates oversized bodies instead of buffering without bound", async () => {
		const oversized = "a".repeat(300 * 1024);
		const detached = await detachWebhookResponse(new Response(oversized, { status: 200 }));

		const text = await detached.text();
		expect(text.length).toBeLessThan(oversized.length);
		expect(detached.status).toBe(200);
	});

	it("handles bodyless responses", async () => {
		const detached = await detachWebhookResponse(new Response(null, { status: 204 }));

		expect(detached.status).toBe(204);
		expect(await detached.text()).toBe("");
	});
});
