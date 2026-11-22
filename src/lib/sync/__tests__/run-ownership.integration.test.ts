// @vitest-environment node
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildSshParamsFromServer } from "@/lib/ssh/client";
import { executeSyncJob, reclaimStaleRunningSyncJobs } from "../service-runtime";

// Only the cleanup of the abandoned transfer would need remote hosts.
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: vi.fn(async (server: { host: string }) => ({ host: server.host })),
  execRemoteCommand: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
}));

it.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("a late owner cannot finish or renew the successor's sync", async () => {
  const database = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) throw new Error("isolated database required");
  const id = randomUUID();
  await prisma.server.createMany({ data: ["a", "b"].map(x => ({ id: id+x, name: x, host: x + ".old.invalid", hostKeySha256: "fixture-pin", username: "fixture", tags: [] })) });
  const job = await prisma.syncJob.create({ data: { name: id, sourceServerId: id+"a", targetServerId: id+"b", sourcePath: "/fixture", targetPath: "/fixture" } });
  function start(message: string) {
    let claim!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { claim = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const done = executeSyncJob(job.id, { onClaimed: async () => { claim(); await wait; throw new Error(message); } });
    return { entered, release, done };
  }
  const first = start("old");
  let second: ReturnType<typeof start> | undefined;
  try {
    await first.entered;
    await prisma.server.update({ where: { id: id+"b" }, data: { host: "new.invalid" } });
    await prisma.syncJob.update({ where: { id: job.id }, data: { updatedAt: new Date(0) } });
    expect(await reclaimStaleRunningSyncJobs()).toContain(job.id);
    expect(vi.mocked(buildSshParamsFromServer).mock.calls.map(([server]) => server.host)).toContain("b.old.invalid");
    expect(vi.mocked(buildSshParamsFromServer).mock.calls.map(([server]) => server.host)).not.toContain("new.invalid");
    second = start("successor");
    await second.entered;
    const owner = (await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } })).activeRunId;
    expect(owner).toBeTruthy();
    first.release();
    await first.done;
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RUNNING", activeRunId: owner });
    expect(await prisma.syncLog.findUniqueOrThrow({ where: { id: owner! } })).toMatchObject({ status: "RUNNING" });
    second.release();
    await second.done;
    expect(await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "ERROR", activeRunId: null, lastSyncResult: "Failed" });
  } finally {
    first.release();
    second?.release();
    await Promise.allSettled([first.done, second?.done]);
    await prisma.syncJob.delete({ where: { id: job.id } });
    await prisma.server.deleteMany({ where: { id: { in: [id+"a", id+"b"] } } });
  }
});
