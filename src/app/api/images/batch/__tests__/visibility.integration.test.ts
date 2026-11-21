// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "../route";

const actor = vi.hoisted(() => ({ userId: "", currentTeamId: "", roles: [], permissions: ["image:write"] }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (req: Request, _options: unknown, run: (ctx: unknown) => Promise<Response>) => run({ session: actor, body: await req.json() }),
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("atomic image visibility toggles", () => {
  const prefix = "image-toggle-" + randomUUID();
  const ids = ["private", "public", "other"].map(name => prefix + name);
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("Requires an isolated test database");
    actor.userId = actor.currentTeamId = prefix;
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.user.createMany({ data: [prefix, prefix + "other"].map(id => ({ id, username: id, passwordHash: "fixture" })) });
    await prisma.imageUpload.createMany({ data: ids.map((id, i) => ({
      id, filename: id, storageKey: id, mimeType: "image/png", sizeBytes: 1, isPublic: i === 1,
      teamId: prefix, userId: i === 2 ? prefix + "other" : prefix,
    })) });
  });
  afterAll(async () => {
    await prisma.imageUpload.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [prefix, prefix + "other"] } } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });
  it("flips a mixed selection twice concurrently while preserving the other owner's image", async () => {
    const toggle = () => POST(new Request("https://test/api/images/batch", { method: "POST", body: JSON.stringify({ action: "togglePublic", ids }) }));
    const responses = await Promise.all([toggle(), toggle()]);
    for (const response of responses) expect(await response.json()).toMatchObject({ updated: 2 });
    const rows = await prisma.imageUpload.findMany({ where: { id: { in: ids } } });
    expect(ids.map(id => rows.find(row => row.id === id)!.isPublic)).toEqual([false, true, false]);
  });
});
