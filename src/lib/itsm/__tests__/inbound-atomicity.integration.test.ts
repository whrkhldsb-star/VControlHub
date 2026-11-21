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
    await prisma.itsmEvent.deleteMany({ where: { teamId: prefix } });
    await prisma.ticketComment.deleteMany({ where: { ticket: { teamId: prefix } } });
    await prisma.ticket.deleteMany({ where: { teamId: prefix } });
    await prisma.itsmConnection.deleteMany({ where: { teamId: prefix } });
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

  it("rejects an unknown status before the comment, accepts a correction, and acknowledges an unchanged status", async () => {
    const target = await ticket("State sync");
    const input = { id: 7301, ticketId: target.id, commentBody: "Note", status: "unmapped" };
    await expect(deliver(input)).rejects.toMatchObject({ status: 400 });
    await expect(deliver({ ...input, status: 7 })).rejects.toMatchObject({ status: 400 });
    await expect(deliver({ ...input, status: "OPEN" + " ".repeat(40) + "invalid" })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.ticketComment.count({ where: { ticketId: target.id } })).toBe(0);
    const where = { connectionId_externalId: { connectionId, externalId: "7301" } };
    expect(await prisma.itsmEvent.findUnique({ where })).toMatchObject({ status: "error" });
    for (let replay = 0; replay < 2; replay++) {
      await expect(deliver({ ...input, status: "in progress" })).resolves.toMatchObject({ action: "comment_status_update" });
    }
    expect(await prisma.ticketComment.count({ where: { ticketId: target.id } })).toBe(1);
    await expect(deliver({ id: 7302, ticketId: target.id, status: "IN_PROGRESS" })).resolves.toMatchObject({ action: "acknowledged", event: { status: "ok" } });
    expect(await prisma.ticketEscalation.count({ where: { ticketId: target.id } })).toBe(1);
  });

  it("keeps distinct long sender IDs and maps both critical and an unrecognized priority", async () => {
    const sender = "s".repeat(256);
    const first = await deliver({ externalId: sender + "1", title: "first", priority: "critical" });
    const second = await deliver({ externalId: sender + "2", title: "second", priority: "unmapped" });
    expect(first.event.externalId).not.toBe(second.event.externalId);
    expect(first.event.payload.sourceConnectionId).toBe(connectionId);
    const urgent = await prisma.ticket.findUniqueOrThrow({ where: { id: first.ticketId! } });
    expect(urgent.priority).toBe("URGENT");
    expect(Math.abs(urgent.slaDueAt!.getTime() - urgent.createdAt.getTime() - 2 * 3_600_000)).toBeLessThan(2_000);
    expect(await prisma.ticket.findUnique({ where: { id: second.ticketId! } })).toMatchObject({ priority: "NORMAL" });
    expect((await deliver({ externalId: sender + "1", title: "replay" })).ticketId).toBe(first.ticketId);
    await expect(deliver({ externalId: {}, title: "malformed" })).rejects.toMatchObject({ status: 400 });
  });

  it("authenticates native Telegram and Slack envelopes, including the Slack challenge", async () => {
    const native = async (provider: string) => (await prisma.itsmConnection.create({ data: {
      name: provider, provider, direction: "inbound",
      credentialsEnc: JSON.stringify({ signingSecret: secret, ...(provider === "slack" ? { webhookSecret: "outbound-only" } : {}) }), teamId: prefix,
    } })).id;
    const telegram = await native("telegram");
    const json = { update_id: 700, message: { text: "Database unavailable" } };
    const tg = { connectionId: telegram, json, rawBody: JSON.stringify(json), headers: new Headers({ "X-Telegram-Bot-Api-Secret-Token": secret }), signatureHeader: null, systemUserId: prefix };
    const created = await handleInboundWebhook(tg);
    expect(created.event).toMatchObject({ connectionId: telegram, externalId: "700", status: "ok" });
    expect(await prisma.ticket.findUnique({ where: { id: created.ticketId! } })).toMatchObject({ title: json.message.text, createdBy: prefix });
    expect((await handleInboundWebhook(tg)).ticketId).toBe(created.ticketId);
    const slack = await native("slack");
    const call = (json: Record<string, unknown>, key: string) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const rawBody = JSON.stringify(json);
      const signature = "v0=" + createHmac("sha256", key).update("v0:" + ts + ":" + rawBody).digest("hex");
      return handleInboundWebhook({ connectionId: slack, json, rawBody, signatureHeader: signature,
        headers: new Headers({ "x-slack-request-timestamp": ts }), systemUserId: prefix });
    };
    const hello = { type: "url_verification", challenge: "challenge-value" };
    await expect(call(hello, "wrong")).rejects.toMatchObject({ status: 403 });
    await expect(call(hello, secret)).resolves.toMatchObject({ challenge: hello.challenge, ticketId: null });
    const message = { type: "event_callback", event_id: "Ev7", event: { type: "message", text: "Disk full" } };
    const slackTicket = await call(message, secret);
    expect(slackTicket.event).toMatchObject({ connectionId: slack, externalId: "Ev7" });
    expect(await prisma.ticket.findUnique({ where: { id: slackTicket.ticketId! } })).toMatchObject({ title: "Disk full" });
  });
});
