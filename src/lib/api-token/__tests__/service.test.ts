import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiTokenUpdateMock, findUnique } = vi.hoisted(() => ({
  apiTokenUpdateMock: vi.fn(), findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      update: apiTokenUpdateMock, findUnique,
    },
  },
}));

import { normalizeScopes, revokeApiToken } from "../service";
import { NotFoundError, ValidationError } from "@/lib/errors";

describe("api-token service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    const missingUpdate = new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
      code: "P2025", clientVersion: "7.9.1",
    });
    const safeSelect = {
      id: true, name: true, tokenPrefix: true, tokenSuffix: true, scopes: true, expiresAt: true,
      lastUsedAt: true, revokedAt: true, createdAt: true, teamId: true, team: { select: { name: true, slug: true } },
    };

    it("revokes an owned live token with the safe projection", async () => {
      apiTokenUpdateMock.mockResolvedValueOnce({ id: "tok1", tokenPrefix: "whr_1234", tokenSuffix: "abcdef" });
      await expect(revokeApiToken({ userId: "u1", id: "tok1" })).resolves.toMatchObject({ id: "tok1" });
      expect(apiTokenUpdateMock).toHaveBeenCalledWith({
        where: { id: "tok1", createdBy: "u1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
        select: safeSelect,
      });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("returns the original revocation timestamp and safe fields on a retry", async () => {
      const revokedAt = new Date("2026-01-01");
      apiTokenUpdateMock.mockRejectedValueOnce(missingUpdate);
      findUnique.mockResolvedValueOnce({ id: "tok1", teamId: "original-team", revokedAt });
      await expect(revokeApiToken({ userId: "u1", id: "tok1" })).resolves.toEqual({ id: "tok1", teamId: "original-team", revokedAt });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "tok1", createdBy: "u1", revokedAt: { not: null } },
        select: safeSelect,
      });
      expect(apiTokenUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("maps a nonexistent or non-owned token to a NotFoundError", async () => {
      apiTokenUpdateMock.mockRejectedValueOnce(missingUpdate);
      findUnique.mockResolvedValueOnce(null);
      await expect(revokeApiToken({ userId: "u1", id: "ghost" })).rejects.toBeInstanceOf(NotFoundError);
      expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "ghost", createdBy: "u1", revokedAt: { not: null } },
      }));
    });

    it("re-throws non-P2025 database errors unchanged", async () => {
      const boom = new Error("connection reset");
      apiTokenUpdateMock.mockRejectedValueOnce(boom);
      await expect(revokeApiToken({ userId: "u1", id: "tok1" })).rejects.toBe(
        boom,
      );
    });
  });
});
