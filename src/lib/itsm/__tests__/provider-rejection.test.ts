import { describe, expect, it, vi } from "vitest";

import { buildOutboundBody, deliverOutbound, providerRejection, UNKNOWN_RECEIPT } from "../adapters";

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("@/lib/security/webhook-url", async (original) => ({
	...await original<typeof import("@/lib/security/webhook-url")>(), fetchWebhookSafely: transport,
}));

// DingTalk and Feishu robots answer HTTP 200 with an error code in the body
// (bad signature, keyword check, rate limit): the delivery failed.
describe("providerRejection", () => {
	it("reads DingTalk's errcode", () => {
		expect(providerRejection("dingtalk", '{"errcode":0,"errmsg":"ok"}')).toBeNull();
		expect(providerRejection("dingtalk", '{"errcode":310000,"errmsg":"sign not match"}')).toBe(
			"dingtalk rejected the message: 310000 sign not match",
		);
	});

	it("reads Feishu's code (and the older StatusCode)", () => {
		expect(providerRejection("feishu", '{"code":0,"msg":"success"}')).toBeNull();
		expect(providerRejection("feishu", '{"StatusCode":0,"StatusMessage":"success"}')).toBeNull();
		expect(providerRejection("feishu", '{"code":19021,"msg":"sign match fail"}')).toBe(
			"feishu rejected the message: 19021 sign match fail",
		);
		expect(providerRejection("feishu", '{"StatusCode":9499,"StatusMessage":"Bad Request"}')).toBe(
			"feishu rejected the message: 9499 Bad Request",
		);
	});

	it("requires a valid receipt only for providers with a business status", () => {
		expect(providerRejection("generic_webhook", '{"errcode":1}')).toBeNull();
		expect(providerRejection("dingtalk", "ok")).toBe(UNKNOWN_RECEIPT);
		expect(providerRejection("feishu", "{}")).toBe(UNKNOWN_RECEIPT);
	});

	it("sends the same event ID in the body and header, and distinguishes pre-dispatch failures from lost responses", async () => {
		const payload = { ticketId: "t", title: "title", description: "desc", status: "OPEN", priority: "NORMAL", eventType: "ticket.comment", eventId: "stable", occurredAt: "2026-01-01T00:00:00Z" };
		const send = () => deliverOutbound({ provider: "generic_webhook", payload, credentials: {},
			config: { webhookUrl: "https://example.test/events", headers: { "iDeMpOtEnCy-KeY": "user-value" } },
		});
		transport.mockResolvedValueOnce({ ok: false, dispatched: false, error: "unavailable" });
		expect(await send()).toMatchObject({ ok: false, outcomeUnknown: false });
		transport.mockResolvedValueOnce({ ok: false, dispatched: true, error: "unconfirmed" });
		expect(await send()).toMatchObject({ ok: false, outcomeUnknown: true });
		const [, request] = transport.mock.calls[0]!;
		expect(Object.keys(request.headers).filter((name) => name.toLowerCase() === "idempotency-key")).toEqual(["Idempotency-Key"]);
		expect(request.headers["Idempotency-Key"]).toBe("stable");
		expect(JSON.parse(request.body)).toMatchObject({ eventId: "stable", timestamp: payload.occurredAt });
		expect(transport.mock.calls[1]![1].body).toBe(request.body);
	});

	it.each(["telegram", "slack", "dingtalk", "feishu"] as const)("shows the reconciliation ID in the %s chat message", (provider) => {
		const payload = { ticketId: "t", title: "T", description: "D", status: "OPEN", priority: "HIGH", eventType: "ticket.comment", eventId: "stable" };
		const message = JSON.parse(buildOutboundBody(provider, payload, {}).body);
		const text = provider === "feishu" ? message.content.text : provider === "dingtalk" ? message.text.content : message.text;
		expect(text).toContain("Event stable");
	});
});
