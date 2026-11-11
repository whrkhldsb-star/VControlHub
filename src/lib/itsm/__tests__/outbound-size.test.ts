import { describe, expect, it } from "vitest";

import { buildOutboundBody } from "../adapters";

/**
 * A ticket reply has no length limit, and it went into the chat message whole.
 * Telegram refuses a message past 4096 characters, DingTalk and Feishu a
 * request past 20 KB: the same refusal on every retry, so the reply never
 * reached the channel and the event ended as failed.
 */
describe("an outbound message a chat provider will accept", () => {
	const payload = (commentBody: string, description = "disk > 90%") => ({
		ticketId: "ticket-0001",
		title: "Disk full",
		description,
		status: "OPEN",
		priority: "HIGH",
		eventType: "ticket.commented",
		commentBody,
	});
	const long = "磁盘告警".repeat(3_000); // 12 000 characters, 36 KB as UTF-8

	it("keeps a Telegram message under 4096 characters, saying that it was cut", () => {
		const body = JSON.parse(buildOutboundBody("telegram", payload(long), { chatId: "42" }).body) as { text: string; chat_id: string };
		expect(body.chat_id).toBe("42");
		expect(body.text.length).toBeLessThanOrEqual(4096);
		expect(body.text.startsWith("[VControlHub] ticket.commented\n#ticket-0 Disk full")).toBe(true);
		expect(body.text.endsWith("…")).toBe(true);
	});

	it.each(["dingtalk", "feishu"] as const)("keeps a %s request under 20 KB", (provider) => {
		const packed = buildOutboundBody(provider, payload(long, long), {});
		expect(Buffer.byteLength(packed.body)).toBeLessThan(20_000);
		const body = JSON.parse(packed.body) as { text?: { content: string }; content?: { text: string }; ticket: { id: string } };
		expect(body.text?.content ?? body.content?.text).toContain("Disk full");
		expect(body.ticket.id).toBe("ticket-0001");
	});

	it("never cuts a character in two", () => {
		// 😀 is two UTF-16 units: a cut between them leaves a lone surrogate.
		const body = JSON.parse(buildOutboundBody("telegram", payload("😀".repeat(4_000)), { chatId: "42" }).body) as { text: string };
		expect(body.text.isWellFormed()).toBe(true);
	});

	it("leaves an ordinary message and a generic webhook's payload as they are", () => {
		const short = buildOutboundBody("telegram", payload("restarted nginx"), { chatId: "42" });
		expect(JSON.parse(short.body).text).toBe("[VControlHub] ticket.commented\n#ticket-0 Disk full\nstatus=OPEN priority=HIGH\ncomment: restarted nginx");
		// A receiver of its own: it gets the whole reply.
		const generic = JSON.parse(buildOutboundBody("generic_webhook", payload(long), {}).body) as { comment: { body: string } };
		expect(generic.comment.body).toBe(long);
	});
});
