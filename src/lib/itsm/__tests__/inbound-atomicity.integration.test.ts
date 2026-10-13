// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { handleInboundWebhook } from "../service-inbound";

/**
 * ITSM inbound side effects and their `applied` marker on a real PostgreSQL.
 * The failure is injected by the database itself: a trigger rejects the
 * marker write for this test's connection, i.e. the second write fails after
 * the ticket/comment/status write already ran. The ticket change and the
 * marker must commit together or not at all, so the sender's retry applies
 * the change exactly once.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ITSM inbound: side effect and applied marker are atomic", () => {
  const prefix = `itsm-${randomUUID()}`;
  const secret = "test-inbound-secret";
  const trigger = `vch_test_fail_applied_${randomUUID().replace(/-/g, "")}`;
  let connectionId: string;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, name: prefix, slug: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    const connection = await prisma.itsmConnection.create({
      data: {
        name: prefix,
        provider: "webhook",
        direction: "inbound",
        enabled: true,
        // Plain JSON passes decryptJsonCredentials (pre-encryption rows).
        credentialsEnc: JSON.stringify({ webhookSecret: secret }),
        config: {},
        teamId: prefix,
      },
    });
    connectionId = connection.id;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."connectionId" = '${connectionId}' AND NEW.status = 'pending' AND NEW.payload->>'applied' = 'true' THEN
          RAISE EXCEPTION 'injected: applied marker write failed';
        END IF;
        RETURN NEW;
      END $$`);
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON itsm_events`);
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON itsm_events`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    await prisma.itsmEvent.deleteMany({ where: { connectionId } });
    await prisma.ticketComment.deleteMany({ where: { ticket: { teamId: prefix } } });
    await prisma.ticket.deleteMany({ where: { teamId: prefix } });
    await prisma.itsmConnection.deleteMany({ where: { id: connectionId } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  const failMarker = () => prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger} BEFORE UPDATE ON itsm_events FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
  );
  const deliver = (json: Record<string, unknown>) => {
    const rawBody = JSON.stringify(json);
    return handleInboundWebhook({
      connectionId,
      rawBody,
      signatureHeader: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
      json,
      systemUserId: prefix,
    });
  };
  const ticket = (title: string) => prisma.ticket.create({
    data: { title, description: title, status: "OPEN", priority: "NORMAL", createdBy: prefix, teamId: prefix },
  });

  it("ticket creation: a failed marker leaves no ticket; the retry creates exactly one", async () => {
    const event = { type: "ticket.create", id: `${prefix}-create`, title: `${prefix} disk full` };
    await failMarker();
    await expect(deliver(event)).rejects.toThrow(/injected/);
    expect(await prisma.ticket.count({ where: { teamId: prefix, title: event.title } })).toBe(0);
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON itsm_events`);

    await expect(deliver(event)).resolves.toMatchObject({ action: "create" });
    expect(await prisma.ticket.count({ where: { teamId: prefix, title: event.title } })).toBe(1);
    await expect(deliver(event)).resolves.toMatchObject({ action: "create" });
    expect(await prisma.ticket.count({ where: { teamId: prefix, title: event.title } })).toBe(1);
  });

  it("comment: a failed marker leaves no comment; the retry adds exactly one", async () => {
    const target = await ticket(`${prefix} comment target`);
    const event = { type: "ticket.comment", id: `${prefix}-comment`, ticketId: target.id, commentBody: "vendor replied" };
    await failMarker();
    await expect(deliver(event)).rejects.toThrow(/injected/);
    expect(await prisma.ticketComment.count({ where: { ticketId: target.id } })).toBe(0);
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON itsm_events`);

    await expect(deliver(event)).resolves.toMatchObject({ action: "comment" });
    expect(await prisma.ticketComment.count({ where: { ticketId: target.id } })).toBe(1);
  });

  it("status: a failed marker leaves the status unchanged; the retry applies the transition once", async () => {
    const target = await ticket(`${prefix} status target`);
    const event = { type: "ticket.update", id: `${prefix}-status`, ticketId: target.id, status: "in progress" };
    await failMarker();
    await expect(deliver(event)).rejects.toThrow(/injected/);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("OPEN");
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON itsm_events`);

    await expect(deliver(event)).resolves.toMatchObject({ action: "status_update" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("IN_PROGRESS");
  });
});
