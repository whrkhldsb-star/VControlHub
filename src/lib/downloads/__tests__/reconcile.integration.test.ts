// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { reconcileStaleRunningDownloadTasks } from "../reconcile";

const fixture = vi.hoisted(() => ({ failIndex: false }));
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: async () => ({}),
  execRemoteCommand: async () => ({ stdout: "COMPLETED\n0\n/data/empty.bin", exitCode: 0 }),
}));
vi.mock("@/lib/downloads/helpers", async (original) => {
  const actual = await original<typeof import("../helpers")>();
  return { ...actual, indexDownloadedFileEntry: async (...args: Parameters<typeof actual.indexDownloadedFileEntry>) => {
    await actual.indexDownloadedFileEntry(...args);
    if (fixture.failIndex) throw new Error("injected index failure");
  } };
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("download recovery PostgreSQL transaction", () => {
  const id = `download-audit-${randomUUID()}`;
  let ready = false;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test/.test(database.pathname)) {
      throw new Error("Download integration requires an isolated loopback audit/test database");
    }
    await prisma.server.create({ data: { id, name: id, host: "192.0.2.1", port: 22, username: "fixture", connectionType: "PASSWORD", enabled: false } });
    await prisma.storageNode.create({ data: { id, name: id, driver: "SFTP", serverId: id, basePath: "/data" } });
    await prisma.downloadTask.create({ data: { id, serverId: id, url: "https://example.invalid/empty.bin", targetPath: "/data", status: "RUNNING", pid: 123, updatedAt: new Date(0) } });
    ready = true;
    const findMany = prisma.downloadTask.findMany.bind(prisma.downloadTask);
    vi.spyOn(prisma.downloadTask, "findMany").mockImplementation((args) => findMany({ ...args, where: { ...args?.where, id } }) as never);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (ready) {
      await prisma.storageNode.delete({ where: { id } });
      await prisma.server.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("rolls back a failed index, retries once, and preserves a zero-byte result", async () => {
    fixture.failIndex = true;
    expect(await reconcileStaleRunningDownloadTasks()).toEqual({ completed: 0, failed: 0, ids: [] });
    expect((await prisma.downloadTask.findUniqueOrThrow({ where: { id } })).status).toBe("RUNNING");
    expect(await prisma.fileEntry.count({ where: { storageNodeId: id } })).toBe(0);

    fixture.failIndex = false;
    expect(await reconcileStaleRunningDownloadTasks()).toEqual({ completed: 1, failed: 0, ids: [id] });
    expect(await prisma.downloadTask.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "COMPLETED", fileSize: "0", completedBytes: "0" });
    expect(await prisma.fileEntry.findFirst({ where: { storageNodeId: id } })).toMatchObject({ relativePath: "empty.bin", size: BigInt(0) });
    expect(await reconcileStaleRunningDownloadTasks()).toEqual({ completed: 0, failed: 0, ids: [] });
    expect(await prisma.fileEntry.count({ where: { storageNodeId: id } })).toBe(1);
  });
});
