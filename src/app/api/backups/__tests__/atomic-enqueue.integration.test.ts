// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { POST as create } from "../route";
import { POST as retry } from "../[id]/retry/route";

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: vi.fn() }));
vi.mock("@/lib/job/service", async (load) => ({
  ...await load<typeof import("@/lib/job/service")>(),
  enqueueJob: async () => { throw new Error("queue unavailable"); },
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("atomic manual backup dispatch", () => {
  const id = randomUUID();
  const post = (pathname: string, body?: object) => new Request("http://localhost" + pathname, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires an isolated test database");
    await prisma.user.create({ data: { id, username: id, passwordHash: "fixture" } });
    vi.mocked(requireApiPermission).mockResolvedValue({ session: {
      userId: id, username: id, roles: ["admin"], currentTeamId: null, mustChangePassword: false,
    } });
  });
  afterAll(async () => {
    await prisma.backupRecord.deleteMany({ where: { createdBy: id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  it("rolls back both a new record and a retry claim if the job cannot be inserted", async () => {
    expect((await create(post("/api/backups", { type: "DATABASE" }))).status).toBe(500);
    expect(await prisma.backupRecord.count({ where: { createdBy: id } })).toBe(0);
    const failed = await prisma.backupRecord.create({ data: {
      createdBy: id, type: "DATABASE", status: "FAILED", errorMessage: "first failure", filePath: id + ".sql.gz",
    } });
    expect((await retry(post("/api/backups/" + failed.id + "/retry"), { params: Promise.resolve({ id: failed.id }) })).status).toBe(500);
    expect(await prisma.backupRecord.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({
      status: "FAILED", errorMessage: "first failure", updatedAt: failed.updatedAt,
    });
  });
});
