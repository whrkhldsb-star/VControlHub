import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiProvider: {
      findMany: vi.fn(),
    },
    aiConversation: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/crypto/service", () => ({
  encrypt: (value: string) => `encrypted:${value}`,
  decrypt: (value: string) => value.replace(/^encrypted:/, ""),
  isEncrypted: (value: string) => value.startsWith("encrypted:"),
}));
vi.mock("@/lib/runtime-settings/service", () => ({
  getAiProviderListLimit: vi.fn(async () => 42),
  getAiConversationListLimit: vi.fn(async () => 123),
}));

const { listProviders, listConversations } = await import("./service");

describe("AI service list hydration limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.aiProvider.findMany.mockResolvedValue([]);
    prismaMock.aiConversation.findMany.mockResolvedValue([]);
  });

  it("uses the runtime-tunable AI provider list limit", async () => {
    await listProviders("u1");

    expect(prismaMock.aiProvider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdBy: "u1" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      take: 42,
    }));
  });

  it("uses the runtime-tunable AI conversation list limit", async () => {
    await listConversations("u1");

    expect(prismaMock.aiConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdBy: "u1" },
      orderBy: { updatedAt: "desc" },
      take: 123,
    }));
  });
});
