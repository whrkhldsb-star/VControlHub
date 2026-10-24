// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

/**
 * A model list asked from the old endpoint came back after the provider was
 * saved with a new endpoint, default model and list, and overwrote the list:
 * new endpoint, new default, old models — and a later failed discovery fell
 * back to that polluted list.
 */
const { fetchModels } = vi.hoisted(() => ({ fetchModels: vi.fn() }));
vi.mock("../provider-http", async (importOriginal) => ({
	...(await importOriginal<typeof import("../provider-http")>()),
	fetchProviderModels: fetchModels,
}));
const { fetchModelsFromProvider } = await import("../service-runtime");

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("model discovery after a save (PostgreSQL)", () => {
	const prefix = `disc-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
		await prisma.aiProvider.create({ data: { id: prefix, name: prefix, baseUrl: "http://old.test/v1", apiKey: "not-a-key", defaultModel: "old-model", availableModels: '["old-model"]', createdBy: prefix } });
	});
	afterAll(async () => {
		await prisma.aiProvider.deleteMany({ where: { id: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("keeps the list saved meanwhile", async () => {
		let answer!: (models: Array<{ id: string }>) => void;
		fetchModels.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
		const discovery = fetchModelsFromProvider(prefix, prefix);
		await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));

		await prisma.aiProvider.update({ where: { id: prefix }, data: { baseUrl: "http://new.test/v1", defaultModel: "new-model", availableModels: '["new-model"]' } });
		answer([{ id: "old-model" }]);
		await discovery;

		const saved = await prisma.aiProvider.findUniqueOrThrow({ where: { id: prefix } });
		expect(saved).toMatchObject({ baseUrl: "http://new.test/v1", defaultModel: "new-model", availableModels: '["new-model"]' });
	});
});
