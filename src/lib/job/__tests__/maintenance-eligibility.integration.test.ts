// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { abandonOrphanPendingJobs } from "../maintenance-worker";
import { completeJob, failJob, failJobTerminal } from "../service-lifecycle";
import { updateClaimedDownload } from "@/lib/downloads/claim";
import { listJobEvents } from "../events";
import { pruneHistoryScope } from "../service-maintenance";

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
  it("rejects expired terminal transitions and download effects before any successor claims the job", async () => {
    const workerId = prefix + "-worker";
    const job = await prisma.job.create({ data: { title: prefix, type: "download.execute", payload: {}, status: "RUNNING",
      workerId, attempts: 1, leaseExpiresAt: old } });
    expect(await completeJob(job.id, workerId, undefined, 1)).toEqual({ count: 0 });
    expect(await failJob(job.id, workerId, "late", { attempts: 1 })).toEqual({ count: 0 });
    expect(await failJobTerminal(job.id, workerId, "late", { attempts: 1 })).toEqual({ count: 0 });
    await expect(updateClaimedDownload({ id: job.id, workerId, attempts: 1 }, undefined,
      { where: { id: prefix }, data: { status: "FAILED" } })).rejects.toThrow();
    expect(await prisma.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "RUNNING", attempts: 1 });
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
  it("keeps a job that became terminal after its tenant's retention snapshot", async () => {
    const type = prefix + "-prune";
    const job = await prisma.job.create({ data: { title: prefix, type, payload: {}, status: "RUNNING", createdAt: old } });
    const terminal = { type, status: "COMPLETED" as const };
    const result = await pruneHistoryScope(async tx => {
      const rows = await tx.job.findMany({ where: terminal, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 });
      await prisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
      return rows;
    }, (tx, retained) => tx.job.deleteMany({ where: { ...terminal, id: { notIn: retained } } }));
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.job.count({ where: { id: job.id } })).toBe(1);
  });
});
