// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { reconcileStaleRunningDownloadTasks } from "@/lib/downloads/reconcile";
import { abandonStaleRunningBackupRecords } from "../service-crud";
import { abandonStalePendingVpsBackupRecords, abandonStaleRunningVpsBackupRecords } from "../vps-backup-service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("orphan scans behind a full live queue", () => {
  const serverId = randomUUID();
  const where = { id: { startsWith: serverId } };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
      throw new Error("isolated loopback test database required");
    }
    await prisma.server.create({ data: { id: serverId, name: "fixture", host: "127.0.0.1", username: "fixture", tags: [] } });
  });
  afterAll(async () => {
    await prisma.job.deleteMany({ where });
    await prisma.backupRecord.deleteMany({ where });
    await prisma.server.deleteMany({ where: { id: serverId } });
    await prisma.$disconnect();
  });

  it.each(["platform-running", "vps-running", "vps-pending", "download"] as const)(
    "advances past 50 live %s records and processes the orphan exactly once", async kind => {
      const queued = kind === "download" || kind === "vps-pending";
      const status = queued ? "PENDING" as const : "RUNNING" as const;
      const records = Array.from({ length: 51 }, (_, index) => {
        const date = new Date(Date.UTC(2000, 0, 1) + index * 1000);
        return { id: serverId + "-" + kind + "-" + index, status, updatedAt: date, createdAt: date };
      });
      const orphan = records[50]!.id;
      const active = records.slice(0, 50);
      if (kind === "platform-running") {
        await prisma.backupRecord.createMany({ data: records.map(row => ({ ...row, type: "FULL", filePath: "fixture" })) });
      } else if (kind === "download") {
        await prisma.downloadTask.createMany({ data: records.map(row => ({ ...row, serverId, targetPath: "/fixture", url: "https://example.test/file" })) });
      } else {
        await prisma.vpsBackupRecord.createMany({ data: records.map(row => ({ ...row, serverId, backupType: "full" })) });
      }
      const type = kind === "download" ? "download.execute" : kind === "platform-running" ? "backup.create" : "vps-backup.create";
      const key = kind === "download" ? "taskId" : kind === "platform-running" ? "backupId" : "recordId";
      await prisma.job.createMany({ data: active.map(({ id }) => ({
        id: id + "-job", title: kind, type, payload: { [key]: id }, status,
        leaseExpiresAt: queued ? null : new Date(Date.now() + 600_000),
      })) });

      if (kind === "download") {
        const runs = await Promise.all([reconcileStaleRunningDownloadTasks(), reconcileStaleRunningDownloadTasks()]);
        expect(runs[0].failed + runs[1].failed).toBe(1);
        expect(await prisma.downloadTask.count({ where: { serverId, status: "PENDING" } })).toBe(50);
        expect(await prisma.downloadTask.findUniqueOrThrow({ where: { id: orphan } })).toMatchObject({ status: "FAILED" });
      } else {
        const sweep = kind === "platform-running" ? abandonStaleRunningBackupRecords
          : kind === "vps-running" ? abandonStaleRunningVpsBackupRecords : abandonStalePendingVpsBackupRecords;
        const runs = await Promise.all([sweep(), sweep()]);
        expect(runs.flatMap(run => run.ids).filter(id => id.startsWith(serverId))).toEqual([orphan]);
        const liveWhere = { id: { in: active.map(row => row.id) }, status };
        const remaining = kind === "platform-running" ? await prisma.backupRecord.count({ where: liveWhere })
          : await prisma.vpsBackupRecord.count({ where: liveWhere });
        expect(remaining).toBe(50);
      }
    },
  );
});
