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

async function body(type: string, model: string, stream = true) {
	mocks.findFirst.mockResolvedValue({ id: "p1", type, baseUrl: "https://api.openai.example/v1", apiKey: "enc" });
	mocks.postProviderChat.mockClear();
	await sendChatRequest({ providerId: "p1", model, temperature: 0.7, top_p: 1, stream, messages: [{ role: "user", content: "hi" }] } as never, "u1");
	return ((mocks.postProviderChat.mock.calls[0] as unknown[])[0] as { body: Record<string, unknown> }).body;
}

/**
 * OpenAI's own endpoint rejects `max_tokens` and the sampling parameters for the o-series and GPT-5 (the preset
 * recommends o3-mini, so every chat was an HTTP 400), and a streamed reply has no usage unless it is asked for.
 */
describe("OpenAI request body", () => {
	beforeEach(() => mocks.postProviderChat.mockClear());

	it.each(["o3-mini", "o1", "o4-mini", "gpt-5", "gpt-5-mini"])("asks %s for max_completion_tokens and leaves sampling out", async (model) => {
		const sent = await body("OPENAI", model);
		expect(sent.max_completion_tokens).toBe(4096);
		for (const key of ["max_tokens", "temperature", "top_p", "frequency_penalty", "presence_penalty"]) expect(sent).not.toHaveProperty(key);
	});

	it("keeps the classic body for chat models, and asks for usage in a stream", async () => {
		const sent = await body("OPENAI", "gpt-4o-mini");
		expect(sent).toMatchObject({ max_tokens: 4096, temperature: 0.7, top_p: 1, stream: true, stream_options: { include_usage: true } });
		expect(sent).not.toHaveProperty("max_completion_tokens");
		expect(await body("OPENAI", "gpt-4o-mini", false)).not.toHaveProperty("stream_options");
	});

	it("does not change what other OpenAI-compatible servers receive", async () => {
		const sent = await body("OPENAI_COMPATIBLE", "o3-mini");
		expect(sent).toMatchObject({ max_tokens: 4096, temperature: 0.7 });
		expect(sent).not.toHaveProperty("stream_options");
		expect(sent).not.toHaveProperty("max_completion_tokens");
	});
});
