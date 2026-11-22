// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { acquireAdvisoryLock, getLockKeys } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { createServerProfile, updateServerProfile } from "../service-profiles";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ssh/client", async original => ({
  ...await original<typeof import("@/lib/ssh/client")>(),
  createRemoteDirectory: vi.fn(),
  execRemoteCommand: vi.fn(async () => ({ stdout: "vcontrolhub-ssh-ready", stderr: "", exitCode: 0 })),
}));
vi.mock("@/lib/ssh/host-key", async original => ({
  ...await original<typeof import("@/lib/ssh/host-key")>(),
  requireApprovedSshHostKey: vi.fn(async () => "SHA256:fixture"),
}));
vi.mock("@/lib/storage/service-nodes", () => ({ checkStorageNodeHealth: vi.fn(async () => ({ healthStatus: "HEALTHY" })) }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("server profile writes on PostgreSQL", () => {
  const prefix = "profile-" + randomUUID().slice(0, 8);
  const teams = [prefix + "-a", prefix + "-b"];
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires a local test database");
    await prisma.team.createMany({ data: teams.map(id => ({ id, name: id, slug: id })) });
  });
  afterAll(async () => {
    await prisma.storageNode.deleteMany({ where: { teamId: { in: teams } } });
    await prisma.server.deleteMany({ where: { teamId: { in: teams } } });
    await prisma.team.deleteMany({ where: { id: { in: teams } } });
    await prisma.$disconnect();
  });

  it("selects exactly one default drive per customer across concurrent onboarding", async () => {
    const create = (teamId: string, index: number) => createServerProfile({
      name: teamId + index, host: teamId + index + ".test", username: "ops", password: "fixture", connectionType: "PASSWORD",
    }, { currentTeamId: teamId });
    await create(teams[0]!, 0);
    await Promise.all([create(teams[1]!, 0), create(teams[1]!, 1)]);
    for (const teamId of teams) expect(await prisma.storageNode.count({ where: { teamId, isDefault: true } })).toBe(1);
  });

  it("preserves a concurrent credential change and deactivation during a name edit", async () => {
    const name = prefix + "-stale";
    const host = name + ".test";
    const server = await prisma.server.create({ data: { name, host, username: "ops", teamId: teams[0], password: "old", connectionType: "PASSWORD" } });
    const unlock = await acquireAdvisoryLock("server-host", host);
    const outcome = updateServerProfile(server.id, { name: "renamed" }).catch((error: unknown) => error);
    try {
      const { k1, k2 } = getLockKeys("server-host", host);
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND NOT granted
            AND classid = ${k1 >>> 0}::oid AND objid = ${k2 >>> 0}::oid) AS waiting`;
        return row?.waiting;
      }).toBe(true);
      await prisma.server.update({ where: { id: server.id }, data: { password: "replacement", enabled: false } });
    } finally {
      await unlock();
    }
    expect(await outcome).toMatchObject({ status: 409 });
    expect(await prisma.server.findUniqueOrThrow({ where: { id: server.id } })).toMatchObject({ name, password: "replacement", enabled: false });
  });

  it("requires the Linux gateway to stop before moving an inherited drive", async () => {
    const name = prefix + "-gateway";
    const server = await prisma.server.create({ data: { name, host: name + ".test", username: "ops", teamId: teams[0],
      password: "fixture", connectionType: "PASSWORD", directGatewayKeyVersion: 4, publicUrl: "https://gateway.test", fileProxyPort: 31888 } });
    await expect(updateServerProfile(server.id, { host: "changed.test", password: "new" })).rejects.toMatchObject({ status: 422 });
    expect((await prisma.server.findUniqueOrThrow({ where: { id: server.id } })).host).toBe(name + ".test");
  });
});
