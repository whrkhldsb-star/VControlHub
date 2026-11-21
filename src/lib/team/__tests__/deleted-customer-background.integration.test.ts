// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Prisma } from "@prisma/client";
import { rawServerScope, serverTeamWhere } from "@/lib/auth/team-scope";
import { getServerInventory, getServerOperationTargets } from "@/lib/server/inventory";
import { getAllUptimeDataInternal } from "@/lib/uptime/internal";
import { prisma } from "@/lib/db";
import { deleteScheduledTask, retryScheduledTask, toggleScheduledTask, updateScheduledTask } from "@/lib/scheduled-task/service";
import { dispatchDueVpsBackupSchedules } from "@/lib/backup/vps-backup-schedule-service";
import { tcpProbe } from "@/lib/server/connectivity";
import { collectAllHealth } from "@/lib/health/service-collect";
import { escalateBreachedTickets } from "@/lib/ticket/sla";
import { hashShareToken, peekShareToken } from "@/lib/share-link/service";
import { oneFileAtATime } from "@/test/helpers/one-file-at-a-time";

// This integration exercises the real fleet query across customers. Parallel
// test files can add hosts to that fleet, so keep network I/O at the boundary.
vi.mock("@/lib/server/connectivity", () => ({ tcpProbe: vi.fn(async () => ({ ok: false, error: "offline" })) }));
vi.mock("@/lib/server/monitor", () => ({ collectServerMetrics: vi.fn(async () => ({ error: "offline" })) }));

/**
 * Deleting a customer hides it and keeps its rows for its history; the
 * platform's background work must stop acting on them. VPS backups kept being
 * dispatched for its servers (a system job, no owner check) and the fleet
 * sweep kept probing them. Real PostgreSQL only (relation filters).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("a deleted customer's servers leave background work", () => {
  // Its schedules are due from the start; another file's dispatch or parking would act on them first.
  oneFileAtATime("vps-backup-schedules");
  const prefix = `deleted-cust-${randomUUID().slice(0, 8)}`;
  const live = { team: `${prefix}-live`, server: `${prefix}-live-srv` };
  const gone = { team: `${prefix}-gone`, server: `${prefix}-gone-srv` };
  const due = new Date(Date.now() - 60_000);

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    // A platform administrator: holds ticket:manage for every customer.
    const adminRole = await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { key: "admin", name: "admin" } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash", roles: { create: { roleId: adminRole.id } } } });
    await prisma.team.create({ data: { id: live.team, slug: live.team, name: live.team } });
    await prisma.team.create({ data: { id: gone.team, slug: gone.team, name: gone.team, deletedAt: new Date() } });
    for (const { team, server } of [live, gone]) {
      await prisma.server.create({ data: { id: server, name: server, host: `${server}.invalid`, port: 1, username: "root", tags: [], teamId: team } });
      await prisma.vpsBackupSchedule.create({
        data: { name: `${prefix}-${server}`, serverId: server, cronExpression: "0 3 * * *", backupType: "FULL", status: "ACTIVE", nextRunAt: due },
      });
      await prisma.ticket.create({
        data: { id: `${team}-ticket`, title: prefix, description: prefix, createdBy: prefix, teamId: team, status: "OPEN", priority: "HIGH", slaDueAt: due },
      });
      await prisma.storageNode.create({ data: { id: `${team}-node`, name: `${team}-node`, driver: "LOCAL", basePath: `/tmp/${team}`, teamId: team } });
      await prisma.shareLink.create({
        data: { tokenHash: hashShareToken(`${team}-token`), storageNodeId: `${team}-node`, path: "report.pdf", entryType: "FILE", name: "report.pdf", teamId: team, createdBy: prefix },
      });
    }
  });

  afterAll(async () => {
    const servers = [live.server, gone.server];
    await prisma.scheduledTask.deleteMany({ where: { createdById: prefix } });
    await prisma.ticket.deleteMany({ where: { createdBy: prefix } });
    await prisma.shareLink.deleteMany({ where: { createdBy: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: { in: [`${live.team}-node`, `${gone.team}-node`] } } });
    await prisma.job.deleteMany({ where: { title: { startsWith: `VPS backup: ${prefix}` } } });
    await prisma.vpsBackupRecord.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.vpsBackupSchedule.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.metricSnapshot.deleteMany({ where: { serverId: { in: servers } } });
    await prisma.server.deleteMany({ where: { id: { in: servers } } });
    await prisma.team.deleteMany({ where: { id: { in: [live.team, gone.team] } } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("applies the live customer boundary to both inventory queries and hydration", async () => {
    for (const teamId of [null, gone.team]) {
      const admin = { userId: prefix, roles: ["admin" as const], currentTeamId: teamId };
      const filter = { id: { in: [live.server, gone.server] } };
      const rows = await prisma.server.findMany({ where: { AND: [filter, serverTeamWhere(admin)] }, select: { id: true } });
      const raw = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT s.id FROM servers s
        WHERE s.id IN (${live.server}, ${gone.server}) AND ${rawServerScope(admin, "canRead")}`);
      expect(rows).toEqual(teamId ? [] : [{ id: live.server }]);
      expect(raw).toEqual(rows);
      const inventory = await getServerInventory(admin, { query: prefix });
      expect(inventory.stats.matching).toBe(rows.length);
      expect(inventory.servers.map(server => server.id)).toEqual(rows.map(server => server.id));
      const targets = await getServerOperationTargets(admin, "command", { query: prefix });
      expect(targets.total).toBe(rows.length);
      expect(targets.rows.map(server => server.id)).toEqual(rows.map(server => server.id));
    }
  });

  it("preserves archived tasks across admin views and still allows a live customer's task to be deleted", async () => {
    const task = { name: prefix, command: "uptime", cronExpression: "0 3 * * *", createdById: prefix, status: "PAUSED" as const };
    const archived = await prisma.scheduledTask.create({ data: { ...task, teamId: gone.team, serverIds: [gone.server] } });
    const active = await prisma.scheduledTask.create({ data: { ...task, teamId: live.team, serverIds: [live.server] } });
    for (const session of [
      { userId: prefix, roles: ["admin" as const], currentTeamId: null },
      { userId: prefix, roles: ["admin" as const], currentTeamId: gone.team },
      { userId: prefix, roles: ["operator" as const], currentTeamId: gone.team },
    ]) {
      await expect(deleteScheduledTask(archived.id, session)).rejects.toMatchObject({ status: 404 });
      await expect(updateScheduledTask(archived.id, { name: "renamed" }, session)).rejects.toMatchObject({ status: 404 });
      await expect(toggleScheduledTask(archived.id, session)).rejects.toMatchObject({ status: 404 });
      await expect(retryScheduledTask(archived.id, session)).rejects.toMatchObject({ status: 404 });
    }
    expect(await prisma.scheduledTask.findUnique({ where: { id: archived.id } })).toEqual(archived);
    await deleteScheduledTask(active.id, { userId: prefix, roles: ["admin"], currentTeamId: null });
    expect(await prisma.scheduledTask.findUnique({ where: { id: active.id } })).toBeNull();
  });

  it("returns an empty uptime list for a teamless caller regardless of imported ids", async () => {
    const id = "__unassigned_servers_require_team_manage__";
    await prisma.server.create({ data: { id, name: prefix, teamId: live.team, host: "example.invalid", username: "fixture", tags: [] } });
    try {
      const session = { userId: prefix, currentTeamId: null, roles: [] };
      expect(await getAllUptimeDataInternal({ session })).toEqual({ servers: [] });
      expect(await prisma.$queryRaw(Prisma.sql`SELECT s.id FROM servers s WHERE ${rawServerScope(session, "canRead")}`)).toEqual([]);
    } finally {
      await prisma.server.delete({ where: { id, teamId: live.team } });
    }
  });

  it("dispatches VPS backups for a live customer's server only", async () => {
    await dispatchDueVpsBackupSchedules();
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: live.server } })).toBe(1);
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: gone.server } })).toBe(0);
  });

  it("escalates a live customer's overdue ticket only", async () => {
    await escalateBreachedTickets();
    const tickets = await prisma.ticket.findMany({ where: { createdBy: prefix }, select: { teamId: true, escalatedAt: true } });
    expect(tickets.find((ticket) => ticket.teamId === live.team)?.escalatedAt).not.toBeNull();
    expect(tickets.find((ticket) => ticket.teamId === gone.team)?.escalatedAt).toBeNull();
    // One stored notice per manager, for the live customer's ticket only.
    const notices = await prisma.notification.findMany({ where: { userId: prefix }, select: { type: true, teamId: true, actionUrl: true, messageCode: true } });
    expect(notices).toEqual([{ type: "ticket_escalation", teamId: live.team, actionUrl: `/tickets/${live.team}-ticket`, messageCode: "ticketSlaEscalated" }]);
  });

  it("stops serving a deleted customer's public share links", async () => {
    await expect(peekShareToken(`${live.team}-token`)).resolves.toMatchObject({ name: "report.pdf" });
    await expect(peekShareToken(`${gone.team}-token`)).rejects.toThrow();
  });

  it("leaves a deleted customer's servers out of the background fleet sweep", async () => {
    const overview = await collectAllHealth();
    const ids = overview.servers.map((server) => server.serverId);
    expect(ids).toContain(live.server);
    expect(ids).not.toContain(gone.server);
    expect(tcpProbe).toHaveBeenCalledWith(`${live.server}.invalid`, 1, expect.any(Number));
    expect(tcpProbe).not.toHaveBeenCalledWith(`${gone.server}.invalid`, 1, expect.any(Number));
  }, 60_000);
});
