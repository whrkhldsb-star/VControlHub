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

import { detectModelCapabilities, sendChatRequest } from "../service-runtime";

async function anthropicBody(model: string) {
	mocks.postProviderChat.mockClear();
	await sendChatRequest({
		providerId: "p1",
		model,
		temperature: 0.7,
		top_p: 1,
		messages: [{ role: "user", content: "Check the disk." }],
	} as never, "u1");
	return ((mocks.postProviderChat.mock.calls[0] as unknown[])[0] as { body: Record<string, unknown> }).body;
}

/**
 * Every conversation carries temperature 0.7 and top_p 1.0. Claude 4.7 and
 * later reject any sampling field with a 400, and Opus 4.1 / 4.5 / 4.6 reject
 * the two together, so an Anthropic provider failed on every current model.
 */
describe("Anthropic sampling parameters", () => {
	beforeEach(() => {
		mocks.findFirst.mockResolvedValue({ id: "p1", type: "ANTHROPIC", baseUrl: "https://api.anthropic.example/v1", apiKey: "enc" });
	});

	it.each(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-4-7", "claude-fable-5-1"])(
		"sends none to %s",
		async (model) => {
			const body = await anthropicBody(model);
			expect(body).not.toHaveProperty("temperature");
			expect(body).not.toHaveProperty("top_p");
		},
	);

	it.each(["claude-sonnet-4-5-20250929", "claude-opus-4-1", "claude-sonnet-4-6"])("sends temperature alone to %s", async (model) => {
		const body = await anthropicBody(model);
		expect(body.temperature).toBe(0.7);
		expect(body).not.toHaveProperty("top_p");
	});

	it.each(["claude-3-5-sonnet-20241022", "claude-sonnet-4-20250514", "glm-4.6"])("keeps both for %s", async (model) => {
		const body = await anthropicBody(model);
		expect(body).toMatchObject({ temperature: 0.7, top_p: 1 });
	});
});

describe("model capabilities of current Claude ids", () => {
	it.each(["claude-sonnet-4-5", "claude-opus-5-5", "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022"])("%s reads images and PDFs", (model) => {
		expect(detectModelCapabilities(model)).toMatchObject({ vision: true, document: true });
	});
});
