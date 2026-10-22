import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	postProviderChat: vi.fn(async () => new Response("{}")),
	findFirst: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { aiProvider: { findFirst: mocks.findFirst } } }));
vi.mock("../provider-http", async (importOriginal) => ({
	...(await importOriginal<typeof import("../provider-http")>()),
	postProviderChat: mocks.postProviderChat,
}));
vi.mock("../service-crud", async (importOriginal) => ({
	...(await importOriginal<typeof import("../service-crud")>()),
	safeDecryptApiKey: () => "sk-test",
}));

import { sendChatRequest } from "../service-runtime";

/**
 * Anthropic takes one system field. Plan mode adds its own system message
 * ahead of the conversation's prompt, and only the first one was sent: the
 * conversation's saved instructions were silently dropped.
 */
describe("Anthropic system prompt", () => {
	beforeEach(() => {
		mocks.findFirst.mockResolvedValue({ id: "p1", type: "ANTHROPIC", baseUrl: "https://api.anthropic.example/v1", apiKey: "enc" });
	});

	it("sends every system message, in order", async () => {
		await sendChatRequest({
			providerId: "p1",
			model: "claude-x",
			messages: [
				{ role: "system", content: "Plan only; do not run anything." },
				{ role: "system", content: "Answer in bullet points." },
				{ role: "user", content: "Check the disk." },
			],
		} as never, "u1");
		const call = (mocks.postProviderChat.mock.calls[0] as unknown[])[0] as { body: { system: string; messages: Array<{ role: string }> } };
		expect(call.body.system).toBe("Plan only; do not run anything.\n\nAnswer in bullet points.");
		expect(call.body.messages.every((message) => message.role !== "system")).toBe(true);
	});
});
