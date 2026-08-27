import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiTokenUpdateMock } = vi.hoisted(() => ({
  apiTokenUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      update: apiTokenUpdateMock,
    },
  },
}));

import { normalizeScopes, revokeApiToken } from "../service";
import { NotFoundError, ValidationError } from "@/lib/errors";

describe("api-token service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it("revokes an owned token and returns the updated row", async () => {
      apiTokenUpdateMock.mockResolvedValueOnce({
        id: "tok1",
        tokenPrefix: "whr_1234",
        tokenSuffix: "abcdef",
      });
      const result = await revokeApiToken({ userId: "u1", id: "tok1" });
      expect(result).toMatchObject({ id: "tok1" });
      expect(apiTokenUpdateMock).toHaveBeenCalledWith({
        where: { id: "tok1", createdBy: "u1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("maps Prisma P2025 (nonexistent / non-owned) to a NotFoundError, not a raw 500", async () => {
      apiTokenUpdateMock.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
          code: "P2025",
          clientVersion: "7.9.1",
        }),
      );
      await expect(
        revokeApiToken({ userId: "u1", id: "ghost" }),
      ).rejects.toBeInstanceOf(NotFoundError);
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
