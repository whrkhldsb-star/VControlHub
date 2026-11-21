// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { GET, PATCH } from "../route";

const authenticate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: authenticate }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("versioned account grants (PostgreSQL)", () => {
  const id = "edit-" + randomUUID();
  const admin = id + "-admin";
  const fixtureRole = id + "-role";
  const url = "http://local/api/users/permissions";
  let ready = false;

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
      throw new Error("Disposable database required");
    }
    await prisma.$transaction(async tx => {
      const role = await tx.role.upsert({ where: { key: "admin" }, update: {}, create: { id: fixtureRole, key: "admin", name: "Administrator" } });
      await tx.user.create({ data: { id: admin, username: admin, passwordHash: "fixture", status: "ACTIVE", mustChangePassword: false, roles: { create: { roleId: role.id } } } });
      await tx.team.create({ data: { id, name: id, slug: id } });
      await tx.identityTemplate.create({ data: { id, name: id, permissions: ["server:read", "storage:read"] } });
      await tx.user.create({ data: { id, username: id, passwordHash: "fixture", teamMembership: { create: { teamId: id, identityTemplateId: id } } } });
      await tx.server.create({ data: { id, teamId: id, name: id, host: "example.invalid", username: "fixture" } });
      await tx.storageNode.create({ data: { id, teamId: id, name: id, driver: "LOCAL", basePath: "/fixture" } });
    });
    ready = true;
    const session = await verifySessionToken(await createSessionToken({ userId: admin, username: admin, currentTeamId: null, roles: ["admin"], mustChangePassword: false }));
    authenticate.mockResolvedValue({ session });
  });

  afterAll(async () => {
    if (ready) {
      await prisma.auditLog.deleteMany({ where: { actorId: admin } });
      await prisma.user.deleteMany({ where: { id: { in: [id, admin] } } });
      await prisma.role.deleteMany({ where: { id: fixtureRole, users: { none: {} } } });
      await prisma.server.delete({ where: { id } });
      await prisma.storageNode.delete({ where: { id } });
      await prisma.identityTemplate.delete({ where: { id } });
      await prisma.team.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  const read = async () => (await GET(new Request(url + "?userId=" + id))).json();
  const save = (version: string, changes: object) => PATCH(new Request(url, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: id, version, ...changes }),
  }));

  it("rejects a stale editor and preserves the other resource's committed restriction after reload", async () => {
    const [first, second] = await Promise.all([read(), read()]);
    expect(first.version).toEqual(second.version);
    const server = { serverId: id, canRead: false, canManage: false, canConnect: false, canFileRead: false, canFileWrite: false, canFileDelete: false };
    const storage = { storageAccessScopeIds: [id], storageAccess: [{ storageNodeId: id, canRead: false }] };
    expect((await save(first.version, { serverAccessScopeIds: [id], serverAccess: [server] })).status).toBe(200);
    expect((await save(second.version, { ...storage, serverAccessScopeIds: [id], serverAccess: [] })).status).toBe(409);
    expect(await prisma.userStorageAccess.count({ where: { userId: id } })).toBe(0);
    const latest = await read();
    expect(latest.version).not.toBe(first.version);
    expect((await save(latest.version, storage)).status).toBe(200);
    expect(await prisma.userServerAccess.findUnique({ where: { userId_serverId: { userId: id, serverId: id } } })).toMatchObject(server);
    expect(await prisma.userStorageAccess.findFirst({ where: { userId: id } })).toMatchObject({ canRead: false });
  });

  it("commits only one of two simultaneous edits based on the same version", async () => {
    const { version } = await read();
    const responses = await Promise.all([
      save(version, { serverAccessScopeIds: [id], serverAccess: [{
        serverId: id, canRead: true, canConnect: true, canManage: false,
        canFileRead: false, canFileWrite: false, canFileDelete: false,
      }] }),
      save(version, { storageAccessScopeIds: [id], storageAccess: [{ storageNodeId: id, canRead: true }] }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  });
});
