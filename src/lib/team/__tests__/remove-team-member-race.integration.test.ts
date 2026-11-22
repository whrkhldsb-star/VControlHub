// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSessionToken, verifySessionToken, type SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { deleteIdentityTemplate } from "@/lib/auth/identity-template-service";
import { removeTeamMember, updateTeamMemberTemplate } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("removeTeamMember versus a concurrent transfer (PostgreSQL)", () => {
  const prefix = `r2-member-${randomUUID().slice(0, 8)}`;
  const id = (name: string) => `${prefix}-${name}`;
  const source = id("source");
  const destination = id("destination");
  const template = id("template");
  const userId = id("user");
  const serverId = id("server");
  const storageNodeId = id("storage");
  let admin: SessionPayload = {
    userId: id("admin"), username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null,
  };

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    const role = await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { key: "admin", name: "Admin" } });
    await prisma.user.create({ data: { id: admin.userId, username: admin.userId, status: "ACTIVE", mustChangePassword: false, passwordHash: "fixture", roles: { create: { roleId: role.id } } } });
    admin = await verifySessionToken(await createSessionToken(admin));
    await prisma.team.createMany({ data: [source, destination].map((id) => ({ id, slug: id, name: id })) });
    await prisma.identityTemplate.create({ data: { id: template, name: template, permissions: [] } });
    await prisma.user.create({ data: { id: userId, username: userId, passwordHash: "test", currentTeamId: source } });
    await prisma.teamMember.create({ data: { userId, teamId: source, identityTemplateId: template } });
    await prisma.server.create({ data: { id: serverId, name: serverId, teamId: destination, host: "127.0.0.1", username: "test", tags: [] } });
    await prisma.storageNode.create({ data: { id: storageNodeId, name: storageNodeId, teamId: destination, driver: "LOCAL", basePath: "/srv" } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: admin.userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, admin.userId] } } });
    await prisma.server.deleteMany({ where: { id: serverId } });
    await prisma.storageNode.deleteMany({ where: { id: storageNodeId } });
    await prisma.identityTemplate.deleteMany({ where: { id: template } });
    await prisma.team.deleteMany({ where: { id: { in: [source, destination] } } });
    await prisma.$disconnect();
  });

  it("retains the membership while archived and makes it available on restoration", async () => {
    await prisma.team.update({ where: { id: source }, data: { deletedAt: new Date() } });
    try {
      await expect(removeTeamMember(source, userId, admin)).rejects.toBeInstanceOf(NotFoundError);
      expect(await prisma.teamMember.count({ where: { userId, teamId: source } })).toBe(1);
    } finally {
      await prisma.team.update({ where: { id: source }, data: { deletedAt: null } });
    }
  });

  it("returns a domain conflict or not-found when a selected template is concurrently deleted", async () => {
    const unused = id("replaceable");
    await prisma.identityTemplate.create({ data: { id: unused, name: unused, permissions: [] } });
    try {
      const [assign, remove] = await Promise.allSettled([
        updateTeamMemberTemplate(source, userId, unused, admin), deleteIdentityTemplate(unused),
      ]);
      if (assign.status === "fulfilled") {
        expect(remove).toMatchObject({ status: "rejected", reason: { status: 409 } });
      } else {
        expect(assign.reason).toMatchObject({ status: 404 });
        expect(remove.status).toBe("fulfilled");
      }
    } finally {
      await prisma.teamMember.update({ where: { userId }, data: { identityTemplateId: template } });
      await prisma.identityTemplate.deleteMany({ where: { id: unused } });
    }
  });

  it("returns NotFound after waiting on the transferred row and preserves the destination grants", async () => {
    const ready = Promise.withResolvers<number>();
    const commit = Promise.withResolvers<void>();
    const transfer = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.teamMember.update({ where: { userId }, data: { teamId: destination } });
      await tx.user.update({ where: { id: userId }, data: { currentTeamId: destination } });
      await tx.userServerAccess.create({ data: { userId, serverId, canConnect: true } });
      await tx.userStorageAccess.create({ data: { userId, storageNodeId, canWrite: true } });
      ready.resolve(backend!.pid);
      await commit.promise;
    }, { timeout: 20_000 }).catch((error: unknown) => {
      ready.reject(error);
      throw error;
    });

    const backend = await ready.promise;
    const removal = removeTeamMember(source, userId, admin).then(
      () => null,
      (error: unknown) => error,
    );
    try {
      // The removal waits on the target user's row before touching membership.
      await expect.poll(async () => {
        const [session] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${backend}::int = ANY(pg_blocking_pids(pid))
              AND query LIKE '%"User"%FOR UPDATE%'
          ) AS blocked
        `;
        return session?.blocked;
      }, { timeout: 5_000 }).toBe(true);
    } finally {
      commit.resolve();
      await transfer;
    }

    expect(await removal).toBeInstanceOf(NotFoundError);
    expect(await prisma.teamMember.findUniqueOrThrow({ where: { userId } })).toMatchObject({ teamId: destination });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ currentTeamId: destination });
    expect(await prisma.userServerAccess.findMany({ where: { userId } })).toEqual([expect.objectContaining({ serverId, canConnect: true })]);
    expect(await prisma.userStorageAccess.findMany({ where: { userId } })).toEqual([expect.objectContaining({ storageNodeId, canWrite: true })]);
  });
});
