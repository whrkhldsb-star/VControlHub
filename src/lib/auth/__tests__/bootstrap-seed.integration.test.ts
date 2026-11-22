// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { ADMIN_BOOTSTRAP } from "../bootstrap";
import { seedBootstrapAdmin } from "../../../../prisma/seed";

vi.mock("../bootstrap", async original => {
  const auth = await original<typeof import("../bootstrap")>();
  return { ...auth, ADMIN_BOOTSTRAP: { ...auth.ADMIN_BOOTSTRAP, username: "bootstrap-" + randomUUID() }, getInitialAdminPassword: () => "fixture-password" };
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("bootstrap grant and customer preference on PostgreSQL", () => {
  const id = randomUUID();
  const username = ADMIN_BOOTSTRAP.username;
  let ready = false;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
      throw new Error("Disposable database required");
    }
    await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { id, key: "admin", name: "Administrator" } });
    await prisma.team.create({ data: { id, slug: id, name: id } });
    await prisma.identityTemplate.create({ data: { id, name: id, permissions: [] } });
    ready = true;
  });

  afterEach(async () => {
    if (ready) await prisma.user.deleteMany({ where: { username } });
  });

  afterAll(async () => {
    if (ready) {
      await prisma.role.deleteMany({ where: { id, users: { none: {} } } });
      await prisma.team.delete({ where: { id } });
      await prisma.identityTemplate.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("grants admin on insertion, preserves all-customers on replay and respects a subsequent demotion", async () => {
    await seedBootstrapAdmin(id);
    const initial = await prisma.user.findUniqueOrThrow({ where: { username }, include: { roles: true } });
    expect(initial.roles).toHaveLength(1);
    expect(initial.currentTeamId).toBe(id);
    await prisma.user.update({ where: { username }, data: { currentTeamId: null, status: "ACTIVE", mustChangePassword: false } });
    await seedBootstrapAdmin(id);
    expect((await prisma.user.findUniqueOrThrow({ where: { username } })).currentTeamId).toBeNull();
    await prisma.user.update({ where: { username }, data: {
      roles: { deleteMany: {} }, teamMembership: { create: { teamId: id, identityTemplateId: id } },
      currentTeamId: id, displayName: "Customer", passwordHash: "customer-hash",
    } });
    await seedBootstrapAdmin(id);
    const customer = await prisma.user.findUniqueOrThrow({ where: { username }, include: { roles: true, teamMembership: true } });
    expect(customer).toMatchObject({ roles: [], teamMembership: { teamId: id }, passwordHash: "customer-hash", displayName: "Customer" });
  });

  it("preserves the password when a pending administrator is demoted during a seed refresh", async () => {
    await seedBootstrapAdmin(id);
    const initial = await prisma.user.findUniqueOrThrow({ where: { username } });
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const demotion = prisma.$transaction(async tx => {
      await tx.user.update({ where: { username }, data: {
        roles: { deleteMany: {} }, teamMembership: { create: { teamId: id, identityTemplateId: id } },
        currentTeamId: id, displayName: "Customer",
      } });
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      locked.resolve(backend!.pid);
      await release.promise;
    }, { timeout: 15_000 });
    const pid = await locked.promise;
    const refresh = seedBootstrapAdmin(id);
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        expect(row?.blocked).toBe(true);
      }, { timeout: 6_000 });
    } finally {
      release.resolve();
      await Promise.all([demotion, refresh]);
    }
    const customer = await prisma.user.findUniqueOrThrow({ where: { username }, include: { roles: true } });
    expect(customer).toMatchObject({ passwordHash: initial.passwordHash, displayName: "Customer", roles: [] });
  });
});
