import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { apiToken: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createApiToken, hashApiToken, verifyApiToken } = await import("./service");
describe("api token service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns plaintext token once and stores only hash plus prefix/suffix", async () => {
    mockPrisma.apiToken.create.mockImplementation(async ({ data, select }: any) => ({ id: "tok1", name: data.name, tokenPrefix: data.tokenPrefix, tokenSuffix: data.tokenSuffix, scopes: data.scopes, expiresAt: data.expiresAt, lastUsedAt: null, revokedAt: null, createdAt: new Date(), selectKeys: Object.keys(select) }));
    const result = await createApiToken({ userId: "u1", name: "cli", scopes: ["read", "write"] });
    expect(result.token).toMatch(/^whr_/);
    const data = mockPrisma.apiToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashApiToken(result.token));
    expect(data.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(data.tokenPrefix).toBe(result.token.slice(0, 8));
    expect(data.tokenSuffix).toBe(result.token.slice(-6));
    expect(result.apiToken).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(result.apiToken)).not.toContain(data.tokenHash);
  });
  it("rejects expired or revoked tokens", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t1", createdBy: "u1", scopes: ["read"], revokedAt: new Date(), expiresAt: null });
    await expect(verifyApiToken("whr_bad")).resolves.toBeNull();
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t2", createdBy: "u1", scopes: ["read"], revokedAt: null, expiresAt: new Date("2020-01-01") });
    await expect(verifyApiToken("whr_bad2")).resolves.toBeNull();
  });
});
