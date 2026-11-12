import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePagePermission: vi.fn(),
	listProviders: vi.fn(),
	listConversations: vi.fn(),
}));

vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: mocks.requirePagePermission }));
vi.mock("@/lib/ai/service", async () => {
	const serialize = await vi.importActual<typeof import("@/lib/ai/service-serialize")>("@/lib/ai/service-serialize");
	return {
		listProviders: mocks.listProviders,
		listConversations: mocks.listConversations,
		serializeProvider: serialize.serializeProvider,
		serializeConversationListItem: serialize.serializeConversationListItem,
	};
});
vi.mock("../ai-client", () => ({ AiClient: () => null }));

import AiPage from "../page";

const provider = {
	id: "p1", name: "OpenAI", type: "openai", apiKey: "v1:0123456789abcdef0123456789abcdef", baseUrl: "https://api.openai.com/v1",
	defaultModel: null, availableModels: "[]", isDefault: true, enabled: true, settings: { reasoningEffort: "high" },
	createdBy: "u1", createdAt: new Date("2026-11-01T00:00:00.000Z"), updatedAt: new Date("2026-11-02T00:00:00.000Z"),
};

describe("/ai page", () => {
	beforeEach(() => {
		mocks.requirePagePermission.mockResolvedValue({ userId: "u1" });
		mocks.listProviders.mockResolvedValue([provider]);
		mocks.listConversations.mockResolvedValue([]);
	});

	it("asks for the chat permission and bounds the prefilled question", async () => {
		const element = await AiPage({ searchParams: Promise.resolve({ q: "x".repeat(5000) }) });
		expect(mocks.requirePagePermission).toHaveBeenCalledWith("ai:chat", { redirectTo: "/ai" });
		expect(element.props.initialDraft).toHaveLength(2000);
	});

	it("hands the client each provider's settings as JSON text and never its stored key", async () => {
		const element = await AiPage({ searchParams: Promise.resolve({}) });
		const [sent] = element.props.initialProviders;
		// It was String(object): "[object Object]".
		expect(sent.settings).toBe('{"reasoningEffort":"high"}');
		expect(sent.defaultModel).toBe("");
		expect(sent.apiKey).toBe("v1:01234...cdef");
		expect(JSON.stringify(element.props)).not.toContain(provider.apiKey);
	});
});
