/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
}));
const tx = {
  user: { findUnique: mocks.userFindUnique, count: mocks.userCount },
  $executeRaw: mocks.executeRaw,
} as unknown as Prisma.TransactionClient;

vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
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
    mocks.transaction.mockImplementation(async (run) => run(tx));
  });

  it("takes the PostgreSQL transaction lock before handing the same transaction to the mutation", async () => {
    const operation = vi.fn(async (client: Prisma.TransactionClient) => {
      expect(client).toBe(tx);
      return 42;
    });
    await expect(withAdminInvariantLock(operation)).resolves.toBe(42);
    const { getLockKeys } = await import("@/lib/concurrency/advisory-lock");
    const { k1, k2 } = getLockKeys("user-admin-invariant", "global");
    const [sql, ...params] = mocks.executeRaw.mock.calls[0]!;
    expect(sql.join("?")).toContain("pg_advisory_xact_lock(?::int, ?::int)");
    expect(params).toEqual([k1, k2]);
    expect(mocks.executeRaw).toHaveBeenCalledBefore(operation);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("rolls the transaction back if the protected operation fails", async () => {
    await expect(withAdminInvariantLock(async () => { throw new Error("update failed"); }))
      .rejects.toThrow("update failed");
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
  });
  it("starts a fresh transaction on a serialization conflict and limits repeated contention", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034", clientVersion: "test",
    });
    mocks.transaction.mockRejectedValueOnce(conflict);
    await expect(withAdminInvariantLock(async () => 42)).resolves.toBe(42);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);

    mocks.transaction.mockClear().mockRejectedValue(conflict);
    await expect(withAdminInvariantLock(async () => 42)).rejects.toMatchObject({ status: 409 });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });

});

describe("assertAdminAccessMayBeRemoved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the change outright when the target is not an admin", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("operator", "viewer"));

    await expect(assertAdminAccessMayBeRemoved("u1", tx)).resolves.toBeUndefined();
    // No need to count anything — the invariant cannot be affected.
    expect(mocks.userCount).not.toHaveBeenCalled();
  });

  it("allows the change when a missing user leaves nothing to protect", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await expect(assertAdminAccessMayBeRemoved("u1", tx)).resolves.toBeUndefined();
    expect(mocks.userCount).not.toHaveBeenCalled();
  });

  it("allows demoting an admin while another active admin remains", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(1);

    await expect(assertAdminAccessMayBeRemoved("u1", tx)).resolves.toBeUndefined();
  });

  it("refuses to remove the last active admin", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(0);

    await expect(assertAdminAccessMayBeRemoved("u1", tx)).rejects.toMatchObject({
      name: "ConflictError",
      message: "backend.user.cannotRemoveLastAdmin",
    });
  });

  it("counts only other ACTIVE administrators, excluding pending and disabled accounts", async () => {
    mocks.userFindUnique.mockResolvedValue(withRoles("admin"));
    mocks.userCount.mockResolvedValue(1);

    await assertAdminAccessMayBeRemoved("u1", tx);

    // A DISABLED admin cannot log in, so counting one would leave the system with
    // no usable administrator.
    expect(mocks.userCount).toHaveBeenCalledWith({
      where: {
        id: { not: "u1" },
        status: "ACTIVE",
        roles: { some: { role: { key: "admin" } } },
      },
    });
  });

  it("keys off the role, not a permission override", async () => {
    // Someone granted every permission individually is still not an admin here.
    mocks.userFindUnique.mockResolvedValue(withRoles("operator"));

    await expect(assertAdminAccessMayBeRemoved("u1", tx)).resolves.toBeUndefined();
    expect(mocks.userCount).not.toHaveBeenCalled();
  });
});

const ADMIN = { type: "admin" } as const;

describe("user schemas", () => {
  it("rejects a username with a path or shell metacharacter", async () => {
    const { createUserSchema } = await import("../schema");

    for (const username of ["a/b", "a b", "a;b", "../etc", "a$b", ""]) {
      expect(createUserSchema.safeParse({ username, password: "secret12", account: ADMIN }).success).toBe(false);
    }
    expect(createUserSchema.safeParse({ username: "a.b-c_1", password: "secret12", account: ADMIN }).success).toBe(
      true,
    );
  });

  it("trims the username before length validation", async () => {
    const { createUserSchema } = await import("../schema");

    const parsed = createUserSchema.safeParse({ username: "  bob  ", password: "secret12", account: ADMIN });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.username).toBe("bob");
  });

  it("requires at least one field on an update", async () => {
    const { updateUserSchema } = await import("../schema");

    // A bare userId would otherwise be a silent no-op that still writes an audit
    // entry.
    expect(updateUserSchema.safeParse({ userId: "u1" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ userId: "u1", action: "disable" }).success).toBe(true);
    // Roles are not part of this endpoint any more.
    expect(updateUserSchema.safeParse({ userId: "u1", roleKeys: [] }).success).toBe(false);
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

  it("requires an account type, and a customer for customer accounts", async () => {
    const { createUserSchema } = await import("../schema");

    expect(createUserSchema.safeParse({ username: "bob", password: "secret12" }).success).toBe(false);
    expect(createUserSchema.safeParse({ username: "bob", password: "secret12", account: { type: "customer" } }).success).toBe(false);
    expect(createUserSchema.safeParse({ username: "bob", password: "secret12", account: { type: "customer", teamId: "t1" } }).success).toBe(true);
  });

  it("enforces the password length bounds on both ends", async () => {
    const { createUserSchema } = await import("../schema");

    // Same floor as the sign-in form and the password policy: a 6–7 character password could be set here
    // but never typed into the login form.
    expect(createUserSchema.safeParse({ username: "bob", password: "1234567", account: ADMIN }).success).toBe(false);
    expect(createUserSchema.safeParse({ username: "bob", password: "12345678", account: ADMIN }).success).toBe(true);
    expect(
      createUserSchema.safeParse({ username: "bob", password: "x".repeat(129), account: ADMIN }).success,
    ).toBe(false);
  });
});
