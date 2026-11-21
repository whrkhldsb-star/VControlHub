// @vitest-environment node
import { describe, expect, it } from "vitest";

import { localizeSchemaMessage } from "@/lib/i18n/schema-copy";
import { withApiCopyLocale } from "@/lib/i18n/api-copy";

import { createItsmConnectionSchema } from "../schema";

function refusals(locale: "zh" | "en", input: unknown): string[] {
	return withApiCopyLocale(locale, () => {
		const parsed = createItsmConnectionSchema.safeParse(input);
		return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${localizeSchemaMessage(issue.message, locale)}`);
	});
}

/**
 * The form sends what it has; what is missing for the chosen channel is said by this schema. Its sentences were
 * English literals, so a Chinese page's toast read "config.webhookUrl: Webhook URL is required when Webhook is enabled for
 * outbound-capable connections".
 */
describe("what a new ITSM connection is refused for", () => {
	it("says in the request's language that the webhook address is missing", () => {
		const input = { name: "Slack 运维群", provider: "slack", direction: "outbound" };
		expect(refusals("zh", input)).toEqual(["config.webhookUrl: 启用 Webhook 时必须填写 Webhook 地址"]);
		expect(refusals("en", input)).toEqual(["config.webhookUrl: Webhook URL is required when Webhook is enabled"]);
	});

	it("says what a Telegram connection needs", () => {
		const input = { name: "值班群", provider: "telegram", direction: "outbound" };
		expect(refusals("zh", input)).toEqual([
			"credentials.botToken: 请填写 API Key",
			"config.chatId: 请填写收件人",
		]);
		expect(refusals("en", input)).toEqual([
			"credentials.botToken: API Key is required",
			"config.chatId: Recipient is required",
		]);
	});

	it("asks an inbound-only connection for its secret", () => {
		const input = { name: "工单回调", provider: "generic_webhook", direction: "inbound" };
		expect(refusals("zh", input)).toEqual(["credentials.webhookSecret: 请填写 API Key"]);
		expect(refusals("en", input)).toEqual(["credentials.webhookSecret: API Key is required"]);
	});

	it("requires a signing credential in both inbound directions, and accepts the native Slack signing secret", () => {
		expect(refusals("en", { name: "Slack", provider: "slack", direction: "inbound", credentials: { signingSecret: "native" } })).toEqual([]);
		expect(refusals("en", { name: "Slack", provider: "slack", direction: "bidirectional", config: { webhookUrl: "https://example.test/hook" } })).toEqual(["credentials.signingSecret: API Key is required"]);
	});

	it("accepts a complete connection", () => {
		expect(refusals("zh", { name: "Slack", provider: "slack", direction: "outbound", config: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } })).toEqual([]);
		expect(refusals("zh", { name: "TG", provider: "telegram", credentials: { botToken: "123:abc", webhookSecret: "callback-secret" }, config: { chatId: "-100123" } })).toEqual([]);
	});
});
