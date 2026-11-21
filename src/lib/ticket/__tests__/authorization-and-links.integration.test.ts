// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { addTicketComment, updateTicketStatus } from "../service";
import { getTicketTimeline, linkTicketServer } from "../timeline";
import { escalateBreachedTickets } from "../sla";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ticket row ownership at commit (PostgreSQL)", () => {
  const id = "ticket-b8-" + randomUUID();
  const viewer = { userId: id + "-staff", currentTeamId: id, roles: [], permissions: ["ticket:read" as const] };
  const server = (suffix: string) => id + suffix;
  const trigger = "ticket_history_" + randomUUID().replaceAll("-", "");

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test|audit|_ci/.test(url.pathname)) throw new Error("Requires a loopback test database");
    await prisma.team.create({ data: { id, slug: id, name: id } });
    await prisma.user.createMany({ data: [id, viewer.userId].map((key) => ({ id: key, username: key, passwordHash: "unused" })) });
    await prisma.server.createMany({ data: ["a", "b", "c", "reject"].map((key) => ({ id: server(key), name: key, host: "host.invalid", teamId: id, username: "test" })) });
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON ticket_escalations`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    await prisma.ticket.deleteMany({ where: { teamId: id } });
    await prisma.server.deleteMany({ where: { teamId: id } });
    await prisma.user.deleteMany({ where: { id: { in: [id, viewer.userId] } } });
    await prisma.team.delete({ where: { id } });
    await prisma.$disconnect();
  });

  const create = (suffix: string) => prisma.ticket.create({ data: {
    id: id + suffix, teamId: id, createdBy: id, assigneeId: viewer.userId, title: suffix, description: suffix,
  } });

  it("rechecks a comment queued behind reassignment and scopes timeline content to participants", async () => {
    const ticket = await create("-race");
    let comment: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticket.id }, data: { assigneeId: null } });
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      comment = addTicketComment({ ticketId: ticket.id, session: viewer, authorId: viewer.userId, body: "reply" }).catch((error) => error);
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${backend!.pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
        expect(row?.waiting).toBe(true);
      });
    });
    expect(await comment!).toMatchObject({ status: 404 });
    expect(await prisma.ticketComment.count({ where: { ticketId: ticket.id } })).toBe(0);
    await expect(getTicketTimeline(ticket.id, viewer)).rejects.toMatchObject({ status: 404 });
    await expect(getTicketTimeline(ticket.id, { ...viewer, permissions: ["ticket:manage"] })).resolves.toMatchObject({ ticketId: ticket.id });
  });

  it("filters current and historical server references by both account permission and object ACL", async () => {
    const ticket = await create("-timeline");
    for (const suffix of ["a", "b"]) await linkTicketServer({ ticketId: ticket.id, serverId: server(suffix) });
    const noServer = await getTicketTimeline(ticket.id, viewer);
    expect(noServer.related.server).toBeNull();
    expect(noServer.events.filter((event) => event.type === "ticket.linked_server")).toEqual([]);
    const reader = { ...viewer, permissions: ["ticket:read" as const, "server:read" as const] };
    await prisma.userServerAccess.create({ data: { serverId: server("a"), userId: viewer.userId, canRead: false } });
    const timeline = await getTicketTimeline(ticket.id, reader);
    expect(timeline.related.server?.id).toBe(server("b"));
    expect(JSON.stringify(timeline)).not.toContain(server("a"));
    expect(timeline.events.some((event) => event.type === "ticket.linked_server")).toBe(true);
  });

  it("commits concurrent rebindings with their actual old links and rolls back when history is rejected", async () => {
    const ticket = await create("-links");
    const link = (suffix: string) => linkTicketServer({ ticketId: ticket.id, serverId: server(suffix) });
    await link("a");
    await Promise.all([link("b"), link("c")]);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const history = await prisma.ticketEscalation.findMany({ where: { ticketId: ticket.id } });
    expect(history.map((item) => item.reason).sort()).toEqual([
      ...["a", "b", "c"].map((key) => "Linked server " + server(key)),
      ...["a", "b", "c"].filter((key) => server(key) !== row.relatedServerId).map((key) => "Unlinked server " + server(key)),
    ].sort());
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."ticketId" = '${ticket.id}' THEN RAISE EXCEPTION 'history unavailable'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ticket_escalations FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    await expect(link("reject")).rejects.toThrow(/history unavailable/);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).relatedServerId).toBe(row.relatedServerId);
  });

  it("keeps an active ticket's escalation cooldown on an identical priority edit", async () => {
    const ticket = await create("-cooldown");
    const now = new Date();
    await prisma.ticket.update({ where: { id: ticket.id }, data: { priority: "HIGH", escalatedAt: now, escalatedTo: id, slaDueAt: now } });
    expect(await updateTicketStatus({ id: ticket.id, priority: "HIGH", skipItsmFanOut: true })).toMatchObject({ escalatedAt: now, escalatedTo: id, slaDueAt: now });
  });

  it.each(["reassign", "retire"])("rechecks the SLA owner when a concurrent %s commits after the scan", async (change) => {
    const ticket = await create("-sla-" + change);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { slaDueAt: new Date(0) } });
    let sweep: Promise<number> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM teams WHERE id = ${id} FOR UPDATE`;
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        sweep = escalateBreachedTickets({ teamId: id });
        await vi.waitFor(async () => {
          const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${backend!.pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
          expect(row?.waiting).toBe(true);
        });
        if (change === "reassign") await tx.ticket.update({ where: { id: ticket.id }, data: { assigneeId: null } });
        else await tx.team.update({ where: { id }, data: { deletedAt: new Date() } });
      });
      expect(await sweep).toBe(0);
      expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toMatchObject({ escalatedAt: null, priority: "NORMAL" });
      expect(await prisma.ticketEscalation.count({ where: { ticketId: ticket.id } })).toBe(0);
    } finally {
      await prisma.team.update({ where: { id }, data: { deletedAt: null } });
      await prisma.ticket.delete({ where: { id: ticket.id } });
    }
  });
});
