// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

const actor = { userId: randomUUID(), roles: ["admin"], currentTeamId: null };
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: (_request: Request, _options: unknown, run: (context: { session: typeof actor }) => unknown) => run({ session: actor }),
}));

import { POST } from "../route";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("concurrent drill requests (PostgreSQL)", () => {
  const id = randomUUID();
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated test database");
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId, passwordHash: "test" } });
    await prisma.backupRecord.create({ data: { id, type: "FILES", filePath: "fixture.tar.gz", status: "COMPLETED" } });
  });
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { createdBy: actor.userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: actor.userId } });
    await prisma.backupRecord.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id: actor.userId } });
    await prisma.$disconnect();
  });
  it("returns one active job to both callers", async () => {
    const request = () => POST(new Request("http://local.test/drill", { method: "POST" }), { params: Promise.resolve({ id }) });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    expect(results.filter((result) => result.deduped)).toHaveLength(1);
    expect(await prisma.job.count({ where: { createdBy: actor.userId } })).toBe(1);
  });
});
