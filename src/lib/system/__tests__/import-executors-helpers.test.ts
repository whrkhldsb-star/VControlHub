/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { RoleKey } from "@/lib/auth/rbac";

vi.mock("@/lib/i18n/service-translations", () => ({
  t: (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
}));

const { parseBigInt, parseDate } = await import("../import-executors-helpers");
const { assertPlatformAdminForConfigImport, isPlatformAdmin } = await import(
  "../platform-admin"
);

describe("parseBigInt", () => {
  it("treats an absent value as 'no limit set', which the export itself emits", () => {
    expect(parseBigInt(null)).toBeNull();
    expect(parseBigInt("")).toBeNull();
  });

  it("parses a plain byte count, including one beyond Number.MAX_SAFE_INTEGER", () => {
    expect(parseBigInt("0")).toBe(BigInt(0));
    expect(parseBigInt("1073741824")).toBe(BigInt("1073741824"));
    expect(parseBigInt("9007199254740993")).toBe(BigInt("9007199254740993"));
  });

  it("refuses an unparsable value instead of silently removing the limit", () => {
    // These fields are quotaBytes / maxFileBytes. Returning null here would mean
    // "unlimited", so a hand-edited bundle could lift a storage cap in silence.
    for (const value of ["10 GB", "1e9", "abc", "1.5", "1_000"]) {
      expect(() => parseBigInt(value, "userStorageAccess.quotaBytes")).toThrow(
        /importInvalidByteCount/,
      );
    }
  });

  it("accepts the alternate radices and surrounding space BigInt() itself allows", () => {
    // Not a fail-open: each of these resolves to a smaller (stricter) limit, and
    // rejecting them would break a bundle BigInt() would have read fine.
    expect(parseBigInt("0x10")).toBe(BigInt(16));
    expect(parseBigInt(" 42 ")).toBe(BigInt(42));
    expect(parseBigInt("+5")).toBe(BigInt(5));
  });

  it("refuses a negative byte count", () => {
    expect(() => parseBigInt("-1", "quota")).toThrow(/importInvalidByteCount/);
  });

  it("names the offending field and value in the error", () => {
    expect(() => parseBigInt("10 GB", "userStorageAccess.quotaBytes")).toThrow(
      /userStorageAccess\.quotaBytes.*10 GB|10 GB.*userStorageAccess\.quotaBytes/,
    );
  });
});

describe("parseDate", () => {
  it("parses an ISO timestamp", () => {
    expect(parseDate("2026-05-04T03:02:01Z").toISOString()).toBe("2026-05-04T03:02:01.000Z");
  });

  it("refuses an unparsable value rather than handing Prisma an Invalid Date", () => {
    // config-schema types these as a bare z.string(), so this is the only guard.
    for (const value of ["", "not-a-date", "2026-13-45"]) {
      expect(() => parseDate(value, "announcements.startsAt")).toThrow(/importInvalidDate/);
    }
  });

  it("names the offending field in the error", () => {
    expect(() => parseDate("nope", "userRoles.assignedAt")).toThrow(/userRoles\.assignedAt/);
  });
});

describe("platform admin gate for config import", () => {
  it("counts only the built-in admin role, never a direct permission grant", () => {
    expect(isPlatformAdmin({ roles: ["admin"] })).toBe(true);
    // user:manage can arrive as a per-user grant; it must not unlock a global write.
    expect(isPlatformAdmin({ roles: ["operator"] })).toBe(false);
    expect(isPlatformAdmin({ roles: ["storage_manager", "viewer"] })).toBe(false);
    expect(isPlatformAdmin({ roles: [] })).toBe(false);
  });

  it("lets an admin through", () => {
    expect(() => assertPlatformAdminForConfigImport({ roles: ["admin"] })).not.toThrow();
  });

  it("rejects a non-admin, a null session and an undefined session", () => {
    const sessions: ({ roles: RoleKey[] } | null | undefined)[] = [
      { roles: ["operator"] },
      null,
      undefined,
    ];
    for (const session of sessions) {
      expect(() => assertPlatformAdminForConfigImport(session)).toThrow(
        /configImportRequiresPlatformAdmin/,
      );
    }
  });

  it("rejects with a Forbidden, not a NotFound or Validation", () => {
    expect(() => assertPlatformAdminForConfigImport(null)).toThrow(
      expect.objectContaining({ name: "ForbiddenError" }),
    );
  });
});
