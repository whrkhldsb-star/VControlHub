/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "there must always be one active admin" invariant. Both callers
 * (PATCH /api/users and PATCH /api/users/permissions) mock this module, so
 * nothing else pins its rules:
 *
 *   - only role-derived admin matters; a DISABLED admin does not count as cover
 *   - the target itself is excluded from the count, so "the last admin" is
 *     decided as of after the pending change
 *   - the check must be usable inside an advisory lock, and the lock must be
 *     released even when the guarded operation throws — a leaked global lock
 *     would wedge every later user mutation
 */

const mocks = vi.hoisted(() => ({
  acquireAdvisoryLock: vi.fn(),
  release: vi.fn(),
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
}));

vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: mocks.acquireAdvisoryLock,
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique, count: mocks.userCount } },
}));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));

const { assertAdminAccessMayBeRemoved, withAdminInvariantLock } = await import(
  "../admin-invariant"
);

function withRoles(...keys: string[]) {
  return { roles: keys.map((key) => ({ role: { key } })) };
}

describe("withAdminInvariantLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireAdvisoryLock.mockResolvedValue(mocks.release);
    mocks.release.mockResolvedValue(undefined);
  });

  it("serializes on one global key so concurrent demotions cannot interleave", async () => {
    await withAdminInvariantLock(async () => "done");

    expect(mocks.acquireAdvisoryLock).toHaveBeenCalledWith("user-admin-invariant", "global");
  });

  it("returns the operation's value", async () => {
    await expect(withAdminInvariantLock(async () => 42)).resolves.toBe(42);
  });

  it("releases the lock when the operation throws", async () => {
    await expect(
      withAdminInvariantLock(async () => {
        throw new Error("update failed");
      }),
    ).rejects.toThrow("update failed");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});

describe("assertAdminAccessMayBeRemoved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the change outright when the target is not an admin", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("operator", "viewer"));

    await expect(assertAdminAccessMayBeRemoved("u1")).resolves.toBeUndefined();
    // No need to count anything — the invariant cannot be affected.
    expect(mocks.userCount).not.toHaveBeenCalled();
  });

  it("allows the change when a missing user leaves nothing to protect", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(assertAdminAccessMayBeRemoved("u1")).resolves.toBeUndefined();
    expect(mocks.userCount).not.toHaveBeenCalled();
  });

  it("allows demoting an admin while another active admin remains", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(1);

    await expect(assertAdminAccessMayBeRemoved("u1")).resolves.toBeUndefined();
  });

  it("refuses to remove the last active admin", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(0);

    await expect(assertAdminAccessMayBeRemoved("u1")).rejects.toMatchObject({
      name: "ConflictError",
      message: "backend.user.cannotRemoveLastAdmin",
    });
  });

  it("excludes the target and every disabled account from the count", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(1);

    await assertAdminAccessMayBeRemoved("u1");

    // A DISABLED admin cannot log in, so counting one would leave the system with
    // no usable administrator.
    expect(mocks.userCount).toHaveBeenCalledWith({
      where: {
        id: { not: "u1" },
        status: { not: "DISABLED" },
        roles: { some: { role: { key: "admin" } } },
      },
    });
  });

  it("keys off the role, not a permission override", async () => {
    // Someone granted every permission individually is still not an admin here.
    mocks.userFindUnique.mockResolvedValue(withRoles("operator"));

    await expect(assertAdminAccessMayBeRemoved("u1")).resolves.toBeUndefined();
    expect(mocks.userCount).not.toHaveBeenCalled();
  });
});

describe("user schemas", () => {
  it("rejects a username with a path or shell metacharacter", async () => {
    const { createUserSchema } = await import("../schema");

    for (const username of ["a/b", "a b", "a;b", "../etc", "a$b", ""]) {
      expect(createUserSchema.safeParse({ username, password: "secret1" }).success).toBe(false);
    }
    expect(createUserSchema.safeParse({ username: "a.b-c_1", password: "secret1" }).success).toBe(
      true,
    );
  });

  it("trims the username before length validation", async () => {
    const { createUserSchema } = await import("../schema");

    const parsed = createUserSchema.safeParse({ username: "  bob  ", password: "secret1" });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.username).toBe("bob");
  });

  it("requires at least one field on an update", async () => {
    const { updateUserSchema } = await import("../schema");

    // A bare userId would otherwise be a silent no-op that still writes an audit
    // entry.
    expect(updateUserSchema.safeParse({ userId: "u1" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ userId: "u1", action: "disable" }).success).toBe(true);
    expect(updateUserSchema.safeParse({ userId: "u1", roleKeys: [] }).success).toBe(true);
  });

  it("will not accept reset_password without a new password", async () => {
    const { updateUserSchema } = await import("../schema");

    const parsed = updateUserSchema.safeParse({ userId: "u1", action: "reset_password" });

    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(["newPassword"]);
  });

  it("rejects an unsupported action rather than ignoring it", async () => {
    const { updateUserSchema } = await import("../schema");

    expect(updateUserSchema.safeParse({ userId: "u1", action: "delete" }).success).toBe(false);
  });

  it("caps roleKeys so one request cannot assign an unbounded role list", async () => {
    const { updateUserSchema } = await import("../schema");

    const tooMany = Array.from({ length: 21 }, (_, i) => `role${i}`);

    expect(updateUserSchema.safeParse({ userId: "u1", roleKeys: tooMany }).success).toBe(false);
  });

  it("enforces the password length bounds on both ends", async () => {
    const { createUserSchema } = await import("../schema");

    expect(createUserSchema.safeParse({ username: "bob", password: "12345" }).success).toBe(false);
    expect(createUserSchema.safeParse({ username: "bob", password: "123456" }).success).toBe(true);
    expect(
      createUserSchema.safeParse({ username: "bob", password: "x".repeat(129) }).success,
    ).toBe(false);
  });
});
