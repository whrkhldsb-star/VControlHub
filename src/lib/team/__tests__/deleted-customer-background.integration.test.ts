// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { dispatchDueVpsBackupSchedules } from "@/lib/backup/vps-backup-schedule-service";
import { collectAllHealth } from "@/lib/health/service-collect";

/**
 * Deleting a customer hides it and keeps its rows for its history; the
 * platform's background work must stop acting on them. VPS backups kept being
 * dispatched for its servers (a system job, no owner check) and the fleet
 * sweep kept probing them. Real PostgreSQL only (relation filters).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("a deleted customer's servers leave background work", () => {
  const prefix = `deleted-cust-${randomUUID().slice(0, 8)}`;
  const live = { team: `${prefix}-live`, server: `${prefix}-live-srv` };
  const gone = { team: `${prefix}-gone`, server: `${prefix}-gone-srv` };
  const due = new Date(Date.now() - 60_000);

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: live.team, slug: live.team, name: live.team } });
    await prisma.team.create({ data: { id: gone.team, slug: gone.team, name: gone.team, deletedAt: new Date() } });
    for (const { team, server } of [live, gone]) {
      // Port 1 on loopback refuses at once: the sweep's probes stay fast.
      await prisma.server.create({ data: { id: server, name: server, host: "127.0.0.1", port: 1, username: "root", tags: [], teamId: team } });
      await prisma.vpsBackupSchedule.create({
        data: { name: `${prefix}-${server}`, serverId: server, cronExpression: "0 3 * * *", backupType: "FULL", status: "ACTIVE", nextRunAt: due },
      });
    }
  });

  afterAll(async () => {
    const servers = [live.server, gone.server];
    await prisma.job.deleteMany({ where: { title: { startsWith: `VPS backup: ${prefix}` } } });
    await prisma.vpsBackupRecord.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.vpsBackupSchedule.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.metricSnapshot.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.server.deleteMany({ where: { id: { in: servers } } });
    await prisma.team.deleteMany({ where: { id: { in: [live.team, gone.team] } } });
    await prisma.$disconnect();
  });

  it("dispatches VPS backups for a live customer's server only", async () => {
    await dispatchDueVpsBackupSchedules();
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: live.server } })).toBe(1);
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: gone.server } })).toBe(0);
  });

  it("leaves a deleted customer's servers out of the background fleet sweep", async () => {
    const overview = await collectAllHealth();
    const ids = overview.servers.map((server) => server.serverId);
    expect(ids).toContain(live.server);
    expect(ids).not.toContain(gone.server);
  }, 60_000);
});
