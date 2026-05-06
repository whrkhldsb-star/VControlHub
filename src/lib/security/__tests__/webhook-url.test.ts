import { describe, expect, it } from "vitest";
import { validateWebhookUrlSyntax } from "../webhook-url";

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
		];

		for (const url of blocked) {
			expect(validateWebhookUrlSyntax(url), url).toMatchObject({ ok: false });
		}
	});
});
