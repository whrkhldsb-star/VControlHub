import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAllSettingsMock } = vi.hoisted(() => ({
	getAllSettingsMock: vi.fn(),
}));

vi.mock("@/lib/settings/service", () => ({ getAllSettings: getAllSettingsMock }));

const {
	__setTelegramFetch,
	assertTelegramReady,
	buildAlertTelegramBody,
	getTelegramConfig,
	parseAlertTelegramChatIds,
	sendAlertTelegram,
	sendTelegramMessage,
} = await import("./telegram");

const ENABLED_SETTINGS = {
	"telegram.enabled": "true",
	"telegram.botToken": "123:ABCDEF-secret",
	"telegram.chatId": "100200300, -100400500\n@channel_alerts",
};

describe("telegram notification delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAllSettingsMock.mockResolvedValue(ENABLED_SETTINGS);
	});

	afterEach(() => {
		__setTelegramFetch(null);
	});

	it("parses chat ids from commas, semicolons, newlines, and CJK separators", () => {
		expect(parseAlertTelegramChatIds("100, -200;300\n@channel_a；@channel_b")).toEqual([
			"100",
			"-200",
			"300",
			"@channel_a",
			"@channel_b",
		]);
	});

	it("builds a plain-text body that joins message + context lines", () => {
		const text = buildAlertTelegramBody({
			title: "CPU high",
			message: "Prod CPU 95%",
			contextLines: ["服务器: prod-1", "阈值: >= 90"],
		});
		expect(text).toBe("Prod CPU 95%\n\n服务器: prod-1\n阈值: >= 90");
	});

	it("returns enabled config with parsed chat ids", async () => {
		const config = await getTelegramConfig();
		expect(config).toEqual({
			enabled: true,
			botToken: "123:ABCDEF-secret",
			chatIds: ["100200300", "-100400500", "@channel_alerts"],
		});
	});

	it("rejects disabled channel and missing bot token / chat ids", () => {
		// 三个独立场景; 用裸 TelegramConfig 验证 assertTelegramReady 内部逻辑
		expect(() => assertTelegramReady({ enabled: false, botToken: "x", chatIds: ["1"] })).toThrow("Telegram channel not enabled");
		expect(() => assertTelegramReady({ enabled: true, botToken: "", chatIds: ["1"] })).toThrow("Bot Token");
		expect(() => assertTelegramReady({ enabled: true, botToken: "x", chatIds: [] })).toThrow("Chat ID");
	});

	it("calls Telegram sendMessage with the bot endpoint and chat_id", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, result: { message_id: 42, chat: { id: 100200300 } } }),
		});
		__setTelegramFetch(fetcher);

		const result = await sendTelegramMessage("100200300", "Body text", { botToken: "tok" });

		expect(fetcher).toHaveBeenCalledWith(
			"https://api.telegram.org/bottok/sendMessage",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ chat_id: "100200300", text: "Body text", disable_web_page_preview: true }),
			}),
		);
		expect(result).toEqual({ chatId: "100200300", messageId: 42 });
	});

	it("surfaces a descriptive error when Telegram returns ok=false", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
		});
		__setTelegramFetch(fetcher);

		await expect(sendTelegramMessage("x", "t", { botToken: "tok" })).rejects.toThrow(
			/Telegram API error: Bad Request: chat not found/,
		);
	});

	it("falls back to HTTP status when Telegram returns a non-JSON error", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: false,
			status: 502,
			json: async () => {
				throw new Error("not json");
			},
		});
		__setTelegramFetch(fetcher);

		await expect(sendTelegramMessage("x", "t", { botToken: "tok" })).rejects.toThrow(/HTTP 502/);
	});

	it("fans out to all configured chat ids and aggregates accepted/rejected", async () => {
		const fetcher = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as { chat_id: string };
			if (body.chat_id === "-100400500") {
				return {
					ok: false,
					status: 400,
					json: async () => ({ ok: false, description: "chat not found" }),
				};
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ ok: true, result: { message_id: 99, chat: { id: body.chat_id } } }),
			};
		});
		__setTelegramFetch(fetcher);

		const result = await sendAlertTelegram({
			title: "CPU high",
			message: "Prod CPU 95%",
			contextLines: ["服务器: prod-1"],
		});

		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(result.accepted.map((r) => r.chatId).sort()).toEqual(["100200300", "@channel_alerts"]);
		expect(result.rejected).toEqual([
			{ chatId: "-100400500", reason: expect.stringMatching(/chat not found/) },
		]);
	});

	it("refuses to send when the Telegram channel is disabled", async () => {
		getAllSettingsMock.mockResolvedValueOnce({ ...ENABLED_SETTINGS, "telegram.enabled": "false" });
		const fetcher = vi.fn();
		__setTelegramFetch(fetcher);

		await expect(sendAlertTelegram({ title: "x", message: "y" })).rejects.toThrow(/not enabled/);
		expect(fetcher).not.toHaveBeenCalled();
	});
});
