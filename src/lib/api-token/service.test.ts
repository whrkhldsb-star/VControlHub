import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { apiToken: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createApiToken, hashApiToken, listApiTokens, verifyApiToken } = await import("./service");
describe("api token service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns plaintext token once and stores only hash plus prefix/suffix", async () => {
    mockPrisma.apiToken.create.mockImplementation(async ({ data, select }: any) => ({ id: "tok1", name: data.name, tokenPrefix: data.tokenPrefix, tokenSuffix: data.tokenSuffix, scopes: data.scopes, expiresAt: data.expiresAt, lastUsedAt: null, revokedAt: null, createdAt: new Date(), selectKeys: Object.keys(select) }));
    const result = await createApiToken({ userId: "u1", name: "cli", scopes: [" read ", "read", "health:read"] });
    expect(result.token).toMatch(/^whr_/);
    const data = mockPrisma.apiToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashApiToken(result.token));
    expect(data.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(data.tokenPrefix).toBe(result.token.slice(0, 8));
    expect(data.tokenSuffix).toBe(result.token.slice(-6));
    expect(data.scopes).toEqual(["read", "health:read"]);
    expect(result.apiToken).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(result.apiToken)).not.toContain(data.tokenHash);
  });
  it("rejects unknown requested scopes instead of creating a misleading lower-privilege token", async () => {
    await expect(createApiToken({ userId: "u1", name: "cli", scopes: ["read", "admin:everything"] })).rejects.toThrow("不支持的 scope: admin:everything");
    expect(mockPrisma.apiToken.create).not.toHaveBeenCalled();
  });
  it("bounds token list hydration newest-first for growing token history", async () => {
    mockPrisma.apiToken.findMany.mockResolvedValue([]);
    await listApiTokens("u1");
    expect(mockPrisma.apiToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdBy: "u1" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
  });
  it("rejects expired, revoked, or owner-disabled tokens", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t1", createdBy: "u1", scopes: ["read"], revokedAt: new Date(), expiresAt: null, creator: { id: "u1", status: "ACTIVE" } });
    await expect(verifyApiToken("whr_bad")).resolves.toBeNull();
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t2", createdBy: "u1", scopes: ["read"], revokedAt: null, expiresAt: new Date("2020-01-01"), creator: { id: "u1", status: "ACTIVE" } });
    await expect(verifyApiToken("whr_bad2")).resolves.toBeNull();
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t3", createdBy: "u1", scopes: ["read"], revokedAt: null, expiresAt: null, creator: { id: "u1", status: "DISABLED" } });
    await expect(verifyApiToken("whr_disabled")).resolves.toBeNull();
    expect(mockPrisma.apiToken.update).not.toHaveBeenCalled();
  });
});
