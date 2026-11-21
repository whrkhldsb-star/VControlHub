// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { abandonOrphanPendingJobs } from "../maintenance-worker";
import { listJobEvents } from "../events";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("maintenance eligibility and event cursors", () => {
  const prefix = randomUUID();
  const old = new Date("2001-01-01");
  beforeAll(() => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires isolated test database");
  });
  afterAll(async () => { await prisma.job.deleteMany({ where: { title: prefix } }); await prisma.$disconnect(); });
  it("skips claimed, recently active and future jobs before applying the candidate limit", async () => {
    const row = { type: "download.execute", title: prefix, payload: {}, availableAt: old, createdAt: old, updatedAt: old };
    const ids = ["delayed", "retry", "recent", "unused"].map(kind => prefix + kind);
    await prisma.job.createMany({ data: [
      { ...row, id: ids[0], availableAt: new Date(Date.now() + 86_400_000) },
      { ...row, id: ids[1], attempts: 1, startedAt: old },
      { ...row, id: ids[2], updatedAt: new Date() },
      { ...row, id: ids[3], type: "retired-" + prefix },
    ] });
    await abandonOrphanPendingJobs({ limit: 1 });
    const states = await prisma.job.findMany({ where: { title: prefix }, select: { id: true, status: true, completedAt: true } });
    expect(states.filter(row => row.status === "CANCELLED")).toEqual([{ id: ids[3], status: "CANCELLED", completedAt: expect.any(Date) }]);
    expect(states.filter(row => row.status === "PENDING")).toHaveLength(3);
  });
  it("reads every event once across timestamp ties and nonmonotonic ids", async () => {
    const job = await prisma.job.create({ data: { title: prefix, type: "test", payload: {} } });
    const ids = ["b", "a", "z"].map(letter => letter + prefix);
    await prisma.jobEvent.createMany({ data: ids.map((id, i) => ({ id, jobId: job.id, type: "test", message: "test",
      createdAt: new Date(i === 2 ? 100 : 200) })) });
    const page = await listJobEvents({ jobId: job.id, limit: 2 });
    const tail = await listJobEvents({ jobId: job.id, beforeId: page[1]!.id });
    expect([...page, ...tail].map(row => row.id)).toEqual(ids);
  });
});
