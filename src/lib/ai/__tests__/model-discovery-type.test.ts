import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	updateMany: vi.fn(async () => ({ count: 1 })),
	fetchModels: vi.fn(async () => [{ id: "claude-opus-5-5" }]),
}));
vi.mock("@/lib/db", () => ({ prisma: { aiProvider: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } } }));
vi.mock("../provider-http", async (importOriginal) => ({
	...(await importOriginal<typeof import("../provider-http")>()),
	fetchProviderModels: mocks.fetchModels,
}));
vi.mock("../service-crud", async (importOriginal) => ({
	...(await importOriginal<typeof import("../service-crud")>()),
	safeDecryptApiKey: () => "sk-ant",
}));

import { fetchModelsFromCredentials, fetchModelsFromProvider } from "../service-runtime";

/** Anthropic lists its models with its own authentication, chosen by type. */
describe("model discovery provider type", () => {
	beforeEach(() => {
		mocks.fetchModels.mockClear();
	});

	it("refreshes a saved Anthropic provider with its type", async () => {
		mocks.findFirst.mockResolvedValue({
			id: "p1", type: "ANTHROPIC", baseUrl: "https://api.anthropic.com/v1", apiKey: "enc",
			availableModels: "[]", defaultModel: "claude-opus-5-5", updatedAt: new Date(),
		});
		await fetchModelsFromProvider("p1", "u1");
		expect(mocks.fetchModels).toHaveBeenCalledWith(expect.objectContaining({ type: "ANTHROPIC" }));
	});

	it("probes new credentials with the type the panel sent", async () => {
		await fetchModelsFromCredentials({ apiKey: "sk-ant", baseUrl: "https://api.anthropic.com/v1", type: "ANTHROPIC" });
		expect(mocks.fetchModels).toHaveBeenCalledWith(expect.objectContaining({ type: "ANTHROPIC" }));
	});
});
