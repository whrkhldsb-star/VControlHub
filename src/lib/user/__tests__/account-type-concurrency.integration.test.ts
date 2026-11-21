// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { setAccountType } from "../account-type";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("platform role grants on PostgreSQL", () => {
  const actorId = `grant-actor-${randomUUID()}`;
  const targetId = `grant-target-${randomUUID()}`;
  const fixtureRoleId = randomUUID();
  let roleId: string;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Role grant integration requires an isolated loopback audit/test database");
    }
    const role = await prisma.role.upsert({
      where: { key: "admin" }, update: {},
      create: { id: fixtureRoleId, key: "admin", name: "Administrator" },
    });
    roleId = role.id;
    await prisma.user.createMany({
      data: [actorId, targetId].map(id => ({
        id, username: id, passwordHash: "isolated-test-hash", status: "ACTIVE", mustChangePassword: false,
      })),
    });
    await prisma.userRole.create({ data: { userId: actorId, roleId } });
  });

  afterAll(async () => {
    if (roleId) {
      await prisma.user.deleteMany({ where: { id: { in: [actorId, targetId] } } });
      await prisma.role.deleteMany({ where: { id: fixtureRoleId, users: { none: {} } } });
    }
    await prisma.$disconnect();
  });

  it("rejects a role revoked after the grant transaction took its snapshot, even if the user row did not change", async () => {
    const session = await verifySessionToken(await createSessionToken({
      userId: actorId, username: actorId, roles: ["admin"], mustChangePassword: false, currentTeamId: null,
    }));

    let result!: Promise<unknown>;
    await prisma.$transaction(async tx => {
      await lockForTransaction(tx, "user-admin-invariant", "global");
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      result = setAccountType(targetId, { type: "admin" }, session).then(() => null, (error: unknown) => error);
      // Wait until the other transaction started its snapshot and is waiting on this advisory lock.
      await vi.waitFor(async () => {
        const [row] = await tx.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${backend!.pid} = ANY(pg_blocking_pids(a.pid))) AS blocked
        `;
        expect(row!.blocked).toBe(true);
      }, { interval: 20, timeout: 4000 });
      await tx.userRole.delete({ where: { userId_roleId: { userId: actorId, roleId } } });
    });
    expect(await result).toBeInstanceOf(ForbiddenError);
    expect(await prisma.userRole.count({ where: { userId: targetId } })).toBe(0);
  });
});
