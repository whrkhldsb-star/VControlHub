// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildExportFile } from "../export-service";

// Commit a writer on another connection just after the exporter receives its
// first server page, before its cursor and later customer lookup are used.
const afterPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async (load) => {
  const original = await load<typeof import("@/lib/db")>();
  if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return original;
  return { ...original, prisma: original.prisma.$extends({ query: { server: {
    async findMany({ args, query }) {
      const rows = await query(args);
      if (rows.length === 500) await afterPage(rows[499]!.id);
      return rows;
    },
  } } }) };
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("consistent configuration snapshot", () => {
  const teamId = randomUUID();
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires an isolated test database");
    await prisma.team.create({ data: { id: teamId, slug: teamId, name: "Before" } });
    await prisma.server.createMany({ data: Array.from({ length: 501 }, (_, index) => ({
      id: teamId + index, teamId, name: String(index).padStart(3, "0"), username: "test", host: "localhost",
    })) });
  });
  afterAll(async () => {
    await prisma.server.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.$disconnect();
  });
  it("keeps all 501 servers and the original owner when the live cursor row is deleted", async () => {
    afterPage.mockImplementationOnce(async (id: string) => {
      await prisma.$transaction([
        prisma.server.delete({ where: { id } }),
        prisma.team.update({ where: { id: teamId }, data: { name: "After" } }),
      ]);
    });
    const file = await buildExportFile({ sourceDomain: "snapshot.test", scope: "team", teamId,
      session: { userId: "operator", username: "operator", roles: ["admin"], currentTeamId: teamId, mustChangePassword: false } });
    expect(afterPage).toHaveBeenCalledOnce();
    expect(new Set(file.tables.servers.map((row) => row.id)).size).toBe(501);
    expect(file.tables.teams).toMatchObject([{ name: "Before" }]);
    expect(await prisma.server.count({ where: { teamId } })).toBe(500);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).name).toBe("After");
  });
});
