// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "../route-post";

const state = vi.hoisted(() => ({ userId: "", tries: 0 }));
vi.mock("@/lib/db", async original => {
  const db = await original<typeof import("@/lib/db")>();
  return { ...db, prisma: db.prisma.$extends({ query: { job: {
    create({ args, query }) {
      if (++state.tries === 2) throw new Error("injected queue failure");
      return query(args);
    },
  } } }) };
});
vi.mock("@/lib/http/api-guard", () => ({ withApiRoute: async (request: Request, _options: unknown, handler: (ctx: unknown) => unknown) =>
  handler({ body: await request.json(), session: { userId: state.userId, currentTeamId: state.userId, roles: ["admin"] } }) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/downloads/source-url", () => ({ assertDownloadSourceUrlSafe: async () => ({ ok: true }) }));
vi.mock("@/lib/i18n/translations", () => ({ t: (key: string) => key, getServerLocale: async () => "en" }));

it.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("commits each batch item and its job together when a later enqueue fails", async () => {
  const db = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("isolated database required");
  const id = randomUUID();
  state.userId = id;
  await prisma.team.create({ data: { id, name: id, slug: id } });
  try {
    await prisma.user.create({ data: { id, username: id, passwordHash: "unused" } });
    await prisma.server.create({ data: { id, teamId: id, name: id, host: "fixture.invalid", username: "fixture", password: "fixture" } });
    await prisma.storageNode.create({ data: { id, serverId: id, teamId: id, name: id, driver: "SFTP", basePath: "/drive" } });
    const urls = ["https://fixture.invalid/one", "https://fixture.invalid/two"];
    const response = await POST(new Request("https://fixture.invalid/api/downloads", { method: "POST", body: JSON.stringify({
      serverId: id, url: urls[0], isBatch: true, batchUrls: urls, targetPath: "/drive",
    }) }));
    expect(response.status).toBe(500);
    const rows = await prisma.downloadTask.findMany({ where: { serverId: id }, select: { id: true, url: true } });
    expect(rows).toEqual([{ id: expect.any(String), url: urls[0] }]);
    expect(await response.json()).toMatchObject({ succeededTaskIds: [rows[0]!.id], remainingUrls: [urls[1]] });
    expect(await prisma.job.findMany({ where: { createdBy: id }, select: { payload: true } })).toMatchObject([{ payload: { taskId: rows[0]!.id } }]);
  } finally {
    await prisma.job.deleteMany({ where: { createdBy: id } });
    await prisma.storageNode.deleteMany({ where: { id } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.team.delete({ where: { id } });
    await prisma.$disconnect();
  }
});
