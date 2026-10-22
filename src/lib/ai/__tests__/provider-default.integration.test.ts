// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crypto/service", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
  isEncrypted: (value: string) => value.startsWith("enc:"),
}));

import { prisma } from "@/lib/db";
import { createProvider, updateProvider } from "../service-crud";

/**
 * Moving the default flag and the write it belongs to are one transaction:
 * a write that fails must not have cleared the user's default provider.
 * Real PostgreSQL only (the unique name constraint does the refusing).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("AI provider default flag", () => {
  const userId = `ai-default-${randomUUID()}`;
  let defaultId = "";

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: userId, username: userId, passwordHash: "x" } });
    const provider = await createProvider({ name: "Main", apiKey: "sk-main", isDefault: true, createdBy: userId });
    defaultId = provider.id;
    await createProvider({ name: "Spare", apiKey: "sk-spare", createdBy: userId });
  });

  afterAll(async () => {
    await prisma.aiProvider.deleteMany({ where: { createdBy: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const currentDefault = async () =>
    (await prisma.aiProvider.findMany({ where: { createdBy: userId, isDefault: true }, select: { id: true } })).map((row) => row.id);

  it("keeps the default when a new default provider is refused for a taken name", async () => {
    await expect(createProvider({ name: "Spare", apiKey: "sk-x", isDefault: true, createdBy: userId }))
      .rejects.toThrow(/providerNameTaken|already have a provider|同名/);
    expect(await currentDefault()).toEqual([defaultId]);
  });

  it("keeps the default when making an unknown provider the default fails", async () => {
    await expect(updateProvider("missing-provider", userId, { isDefault: true })).rejects.toThrow();
    expect(await currentDefault()).toEqual([defaultId]);
  });

  it("keeps the default when renaming the new default to a taken name fails", async () => {
    const spare = await prisma.aiProvider.findFirstOrThrow({ where: { createdBy: userId, name: "Spare" }, select: { id: true } });
    await expect(updateProvider(spare.id, userId, { name: "Main", isDefault: true }))
      .rejects.toThrow(/providerNameTaken|already have a provider|同名/);
    expect(await currentDefault()).toEqual([defaultId]);
  });

  it("leaves exactly one default when two new defaults are created at once", async () => {
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        createProvider({ name: `Race A${round}`, apiKey: "sk-a", isDefault: true, createdBy: userId }),
        createProvider({ name: `Race B${round}`, apiKey: "sk-b", isDefault: true, createdBy: userId }),
      ]);
      expect(await currentDefault()).toHaveLength(1);
    }
  });

  it("leaves exactly one default when two providers are made the default at once", async () => {
    const rows = await prisma.aiProvider.findMany({ where: { createdBy: userId, isDefault: false }, select: { id: true }, take: 2 });
    for (let round = 0; round < 5; round++) {
      await Promise.all(rows.map((row) => updateProvider(row.id, userId, { isDefault: true })));
      expect(await currentDefault()).toHaveLength(1);
    }
  });
});
