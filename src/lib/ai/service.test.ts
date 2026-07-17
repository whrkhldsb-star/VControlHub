import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiProvider: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    aiConversation: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    aiMessage: {
      deleteMany: vi.fn(),
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

const { listProviders, listConversations, createProvider, updateProvider, createConversation } = await import("./service");

describe("AI service list hydration limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.aiProvider.findMany.mockResolvedValue([]);
    prismaMock.aiProvider.create.mockResolvedValue({ id: "p1" });
    prismaMock.aiProvider.findFirst.mockResolvedValue({ id: "p1" });
    prismaMock.aiProvider.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.aiProvider.update.mockResolvedValue({ id: "p1" });
    prismaMock.aiProvider.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiConversation.findMany.mockResolvedValue([]);
    prismaMock.aiConversation.create.mockResolvedValue({
      id: "c1",
      providerId: "p1",
      createdBy: "u1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      provider: { id: "p1", name: "p", type: "OPENAI_COMPATIBLE" },
    });
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

  it("normalizes provider model lists and uses the default Base URL when creating providers", async () => {
    await createProvider({
      name: " OpenAI Compatible ",
      apiKey: " sk-test ",
      availableModels: [" gpt-4o ", "gpt-4o", "", " gpt-4.1 "],
      createdBy: "u1",
    });

    expect(prismaMock.aiProvider.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "OpenAI Compatible",
        apiKey: "encrypted:sk-test",
        baseUrl: "https://api.openai.com/v1",
        availableModels: JSON.stringify(["gpt-4o", "gpt-4.1"]),
      }),
    }));
  });

  it("rejects private AI provider Base URLs before persistence", async () => {
    await expect(createProvider({
      name: "Local compatible",
      apiKey: "sk-local",
      baseUrl: "http://127.0.0.1:11434/v1",
      createdBy: "u1",
    })).rejects.toThrow(/public HTTP\(S\) address/);

    expect(prismaMock.aiProvider.create).not.toHaveBeenCalled();
  });

  it("normalizes duplicate provider model lists on update", async () => {
    await updateProvider("p1", "u1", {
      availableModels: [" claude-3 ", "claude-3", "", "claude-3.5"],
    });

    expect(prismaMock.aiProvider.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1", createdBy: "u1" },
      data: expect.objectContaining({
        availableModels: JSON.stringify(["claude-3", "claude-3.5"]),
      }),
    }));
  });

  it("rejects private AI provider Base URLs on update", async () => {
    await expect(updateProvider("p1", "u1", {
      baseUrl: "http://169.254.169.254/latest/meta-data",
    })).rejects.toThrow(/metadata/);

    expect(prismaMock.aiProvider.update).not.toHaveBeenCalled();
  });

  it("rejects creating a conversation against another user's provider", async () => {
    prismaMock.aiProvider.findFirst.mockResolvedValueOnce(null);

    await expect(
      createConversation({
        providerId: "other-provider",
        model: "gpt-4o",
        createdBy: "u1",
      }),
    ).rejects.toThrow(/not found/i);

    expect(prismaMock.aiProvider.findFirst).toHaveBeenCalledWith({
      where: { id: "other-provider", createdBy: "u1" },
    });
    expect(prismaMock.aiConversation.create).not.toHaveBeenCalled();
  });

  it("creates conversations only against owned providers and omits apiKey from the include", async () => {
    prismaMock.aiProvider.findFirst.mockResolvedValueOnce({ id: "p1", createdBy: "u1" });

    await createConversation({
      providerId: "p1",
      model: "gpt-4o",
      createdBy: "u1",
    });

    expect(prismaMock.aiConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerId: "p1", createdBy: "u1" }),
        include: {
          provider: {
            select: expect.not.objectContaining({ apiKey: true }),
          },
        },
      }),
    );
    const createCall = prismaMock.aiConversation.create.mock.calls[0]?.[0] as
      | { include?: { provider?: { select?: { apiKey?: unknown } } } }
      | undefined;
    expect(createCall?.include?.provider?.select?.apiKey).toBeUndefined();
  });
});
