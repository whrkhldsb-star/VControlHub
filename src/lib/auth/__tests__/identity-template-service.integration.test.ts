// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { deleteIdentityTemplate } from "../identity-template-service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("identity template deletion under PostgreSQL concurrency", () => {
  const id = "template-race-" + randomUUID();
  let ready = false;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Disposable database required");
    }
    await prisma.$transaction([
      prisma.user.create({ data: { id, username: id, passwordHash: "fixture" } }),
      prisma.identityTemplate.create({ data: { id, name: id, permissions: [] } }),
      prisma.team.create({ data: { id, slug: id, name: id } }),
    ]);
    ready = true;
  });

  afterAll(async () => {
    if (ready) {
      await prisma.user.delete({ where: { id } });
      await prisma.identityTemplate.deleteMany({ where: { id } });
      await prisma.team.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("returns a conflict if the first membership commits between reference counting and deletion", async () => {
    let deletion!: Promise<unknown>;
    await prisma.$transaction(async tx => {
      await tx.teamMember.create({ data: { userId: id, teamId: id, identityTemplateId: id } });
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      deletion = deleteIdentityTemplate(id).then(() => null, (error: unknown) => error);
      await expect.poll(async () => {
        // Poll outside the holder's transaction so every read sees newly
        // connected backends, even when pg_stat_activity caches its snapshot.
        const [waiter] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${backend!.pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
        return waiter!.blocked;
      }, { timeout: 8_000 }).toBe(true);
    }, { timeout: 15_000 });
    expect(await deletion).toMatchObject({ status: 409 });
    expect(await prisma.teamMember.count({ where: { identityTemplateId: id } })).toBe(1);
    await prisma.teamMember.delete({ where: { userId: id } });
    await deleteIdentityTemplate(id);
    await expect(deleteIdentityTemplate(id)).rejects.toMatchObject({ status: 404 });
  });
});
