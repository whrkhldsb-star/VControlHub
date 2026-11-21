// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { createApiToken, revokeApiToken } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("API token issuance during revocation (PostgreSQL)", () => {
  const id = `token-race-${randomUUID()}`;
  const roleKeyAdmin = id + "-key-admin";
  const roleGrantAdmin = id + "-grant-admin";
  const fixtureRoleId = id + "-role";
  let adminRoleId: string;
  const grants = ["api-token:manage", "storage:read"];
  let ready = false;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Token integration requires an isolated loopback audit/test database");
    }
    await prisma.$transaction(async tx => {
      const role = await tx.role.upsert({
        where: { key: "admin" }, update: {}, create: { id: fixtureRoleId, key: "admin", name: "Administrator" },
      });
      adminRoleId = role.id;
      for (const adminId of [roleKeyAdmin, roleGrantAdmin]) {
        await tx.user.create({ data: {
          id: adminId, username: adminId, passwordHash: "test", status: "ACTIVE", mustChangePassword: false,
          roles: { create: { roleId: role.id } },
        } });
      }
      await tx.team.create({ data: { id, name: id, slug: id } });
      await tx.identityTemplate.create({ data: { id, name: id, permissions: grants } });
      await tx.user.create({ data: {
        id, username: id, status: "ACTIVE", passwordHash: "test", mustChangePassword: false,
        teamMembership: { create: { teamId: id, identityTemplateId: id } },
      } });
    });
    ready = true;
  });
  beforeEach(async () => {
    await prisma.team.update({ where: { id }, data: { deletedAt: null } });
    await prisma.identityTemplate.update({ where: { id }, data: { permissions: grants } });
  });
  afterAll(async () => {
    if (ready) {
      await prisma.user.deleteMany({ where: { id: { in: [id, roleKeyAdmin, roleGrantAdmin] } } });
      await prisma.role.deleteMany({ where: { id: fixtureRoleId, users: { none: {} } } });
      await prisma.identityTemplate.delete({ where: { id } });
      await prisma.team.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  async function holdRevocation(write: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    const locked = Promise.withResolvers<number>();
    const commit = Promise.withResolvers<void>();
    const revocation = prisma.$transaction(async tx => {
      await write(tx);
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      locked.resolve(backend!.pid);
      await commit.promise;
    }, { timeout: 15_000 });
    const blocker = await Promise.race([locked.promise, revocation.then(() => { throw new Error("Expected pending revocation"); })]);
    return {
      blocker,
      release: async () => { commit.resolve(); await revocation; },
    };
  }

  async function waitForBlockedRequest(blocker: number) {
    await expect.poll(async () => {
      const [result] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blocker}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
      return result?.waiting;
    }, { timeout: 4_000 }).toBe(true);
  }

  it.each(["session", "template grant", "customer"])("waits for %s revocation and rejects the in-flight request", async (change) => {
    const session = await verifySessionToken(await createSessionToken({
      userId: id, username: id, currentTeamId: id, mustChangePassword: false, roles: [],
    }));
    const lock = await holdRevocation(async tx => {
      if (change === "session") {
        await tx.user.update({ where: { id }, data: { sessionEpoch: { increment: 1 } } });
      } else if (change === "template grant") {
        await tx.identityTemplate.update({ where: { id }, data: { permissions: ["api-token:manage"] } });
      } else {
        await tx.team.update({ where: { id }, data: { deletedAt: new Date() } });
      }
    });
    const issuance = createApiToken({ session, name: id, scopes: ["storage:read"] }).then(() => null, (error: unknown) => error);
    try {
      await waitForBlockedRequest(lock.blocker);
    } finally {
      await lock.release();
    }
    expect(await issuance).toBeInstanceOf(change === "session" ? AuthError : ForbiddenError);
    expect(await prisma.apiToken.count({ where: { createdBy: id } })).toBe(0);
  });

  it.each(["role key", "user role"])("holds the administrator grant while the %s is changing", async (change) => {
    const adminId = change === "role key" ? roleKeyAdmin : roleGrantAdmin;
    const session = await verifySessionToken(await createSessionToken({
      userId: adminId, username: adminId, currentTeamId: id, mustChangePassword: false, roles: ["admin"],
    }));
    const lock = await holdRevocation(async tx => {
      if (change === "role key") {
        // Keep other suites' admin role intact when this transaction commits.
        await tx.role.update({ where: { id: adminRoleId }, data: { key: fixtureRoleId } });
        await tx.role.update({ where: { id: adminRoleId }, data: { key: "admin" } });
      } else {
        await tx.userRole.delete({ where: { userId_roleId: { userId: adminId, roleId: adminRoleId } } });
      }
    });
    const issuance = createApiToken({ session, name: change, scopes: ["storage:read"] }).then(
      value => value.apiToken,
      (error: unknown) => error,
    );
    try {
      await waitForBlockedRequest(lock.blocker);
    } finally {
      await lock.release();
    }
    if (change === "role key") {
      expect(await issuance).toMatchObject({ name: change, teamId: id });
    } else {
      expect(await issuance).toBeInstanceOf(ForbiddenError);
      expect(await prisma.apiToken.count({ where: { createdBy: adminId, name: change } })).toBe(0);
    }
  });

  it("returns safe metadata with the first revocation timestamp when two revocations overlap", async () => {
    const session = await verifySessionToken(await createSessionToken({
      userId: id, username: id, currentTeamId: id, mustChangePassword: false, roles: [],
    }));
    const { apiToken } = await createApiToken({ session, name: id, scopes: ["storage:read"] });
    const firstRevocation = new Date("2026-01-01T00:00:00Z");
    const lock = await holdRevocation(tx => tx.apiToken.update({ where: { id: apiToken.id }, data: { revokedAt: firstRevocation } }));
    const duplicate = revokeApiToken({ userId: id, id: apiToken.id });
    try {
      await waitForBlockedRequest(lock.blocker);
    } finally {
      await lock.release();
    }
    const result = await duplicate;
    expect(result).toMatchObject({ id: apiToken.id, teamId: id, revokedAt: firstRevocation });
    expect(result).not.toHaveProperty("tokenHash");
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).revokedAt).toEqual(firstRevocation);
  });
});
