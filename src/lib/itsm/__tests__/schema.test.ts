// @vitest-environment node
import { describe, expect, it } from "vitest";

import { withApiCopyLocale } from "@/lib/i18n/api-copy";

import { createItsmConnectionSchema } from "../schema";

function refusals(locale: "zh" | "en", input: unknown): string[] {
	return withApiCopyLocale(locale, () => {
		const parsed = createItsmConnectionSchema.safeParse(input);
		return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
	});
}

/**
 * The form sends what it has; what is missing for the chosen channel is said by this schema. Its sentences were
 * English literals, so a Chinese page's toast read "config.webhookUrl: webhookUrl is required for
 * outbound-capable connections".
 */
describe("what a new ITSM connection is refused for", () => {
	it("says in the request's language that the webhook address is missing", () => {
		const input = { name: "Slack 运维群", provider: "slack", direction: "outbound" };
		expect(refusals("zh", input)).toEqual(["config.webhookUrl: webhookUrl 不能为空"]);
		expect(refusals("en", input)).toEqual(["config.webhookUrl: webhookUrl is required"]);
	});

	it("says what a Telegram connection needs", () => {
		const input = { name: "值班群", provider: "telegram", direction: "outbound" };
		expect(refusals("zh", input)).toEqual([
			"credentials.botToken: Telegram botToken 不能为空",
			"config.chatId: Telegram chatId 不能为空",
		]);
		expect(refusals("en", input)).toEqual([
			"credentials.botToken: Telegram botToken is required",
			"config.chatId: Telegram chatId is required",
		]);
	});

	it("asks an inbound-only connection for its secret", () => {
		const input = { name: "工单回调", provider: "generic_webhook", direction: "inbound" };
		expect(refusals("zh", input)).toEqual(["credentials.webhookSecret: 仅入站的连接需要设置 webhookSecret，否则任何人都能向它投递"]);
		expect(refusals("en", input)).toEqual(["credentials.webhookSecret: An inbound-only connection needs a webhookSecret; without one anybody can post to it"]);
	});

	it("accepts a complete connection", () => {
		expect(refusals("zh", { name: "Slack", provider: "slack", direction: "outbound", config: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } })).toEqual([]);
		expect(refusals("zh", { name: "TG", provider: "telegram", credentials: { botToken: "123:abc" }, config: { chatId: "-100123" } })).toEqual([]);
	});
});
