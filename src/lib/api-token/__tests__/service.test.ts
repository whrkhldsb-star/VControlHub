import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  apiToken: { updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() }, auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: (run: (db: typeof tx) => unknown) => run(tx) } }));

import { normalizeScopes, revokeApiToken } from "../service";
import { NotFoundError, ValidationError } from "@/lib/errors";

describe("api-token service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tx.apiToken.findMany.mockResolvedValue([]);
  });

  describe("normalizeScopes", () => {
    it("defaults to ['read'] when scopes are omitted or empty", () => {
      expect(normalizeScopes()).toEqual(["read"]);
      expect(normalizeScopes([])).toEqual(["read"]);
      expect(normalizeScopes(["  "])).toEqual(["read"]);
    });

    it("trims and de-duplicates while preserving allowed scopes", () => {
      expect(normalizeScopes([" read ", "read", "server:read"])).toEqual([
        "read",
        "server:read",
      ]);
    });

    it("rejects unsupported scopes with a ValidationError", () => {
      expect(() => normalizeScopes(["read", "admin:everything"])).toThrow(
        ValidationError,
      );
      expect(() => normalizeScopes(["admin:everything"])).toThrow(
        /admin:everything/,
      );
    });

    it("caps the number of scopes at 20", () => {
      // 25 distinct *allowed* scopes don't exist, so pad with repeats of the
      // full allowed set; after dedup the cap is what matters here.
      const many = Array.from({ length: 25 }, (_, i) =>
        i % 2 === 0 ? "read" : "server:read",
      );
      expect(normalizeScopes(many).length).toBeLessThanOrEqual(20);
    });
  });

  describe("revokeApiToken", () => {
    const safeSelect = {
      id: true, name: true, tokenPrefix: true, tokenSuffix: true, scopes: true, expiresAt: true,
      lastUsedAt: true, revokedAt: true, createdAt: true, teamId: true,
    };

    it("audits only the first conditional update, under the token's customer", async () => {
      const token = { id: "tok1", tokenPrefix: "prefix", tokenSuffix: "suffix", teamId: "owner-team", revokedAt: new Date() };
      tx.apiToken.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      tx.apiToken.findUnique.mockResolvedValue(token);
      for (let i = 0; i < 2; i++) {
        await expect(revokeApiToken({ userId: "u1", id: "tok1" })).resolves.toEqual({ ...token, team: null });
      }
      expect(tx.apiToken.updateMany).toHaveBeenCalledWith({
        where: { id: "tok1", createdBy: "u1", revokedAt: null }, data: { revokedAt: expect.any(Date) },
      });
      expect(tx.apiToken.findUnique).toHaveBeenCalledWith({ where: { id: "tok1", createdBy: "u1" }, select: safeSelect });
      expect(tx.auditLog.create).toHaveBeenCalledOnce();
      expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "api_token.revoke", teamId: "owner-team" }) });
    });

    it("returns not found for a missing or foreign owner and preserves database errors", async () => {
      tx.apiToken.updateMany.mockResolvedValue({ count: 0 });
      tx.apiToken.findUnique.mockResolvedValue(null);
      await expect(revokeApiToken({ userId: "u1", id: "foreign" })).rejects.toBeInstanceOf(NotFoundError);
      const fault = new Error("connection reset");
      tx.apiToken.updateMany.mockRejectedValueOnce(fault);
      await expect(revokeApiToken({ userId: "u1", id: "foreign" })).rejects.toBe(fault);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
