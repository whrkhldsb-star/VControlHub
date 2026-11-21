// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createMessage } from "../service-runtime";
import { createConversation, clearConversationMessages, deleteConversation, getConversationById } from "../service-crud";
import { finishChatGeneration, withChatGeneration } from "../chat-generation";
import { createHostedAction, confirmHostedAction, executeSafeAction, getPendingActions, rejectHostedAction } from "../hosted-service";
import { executeServerlessQuery } from "../hosted-safe-queries";
import { getToolByName } from "../hosted-tools";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("hosted chat transactions", () => {
  const id = randomUUID();
  const session = { userId: id, roles: ["admin" as const], currentTeamId: id };
  const providerId = id;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) throw new Error("requires an isolated loopback audit/test database");
    await prisma.team.createMany({ data: [id, id + "-next"].map((team) => ({ id: team, name: team, slug: team })) });
    await prisma.user.create({ data: { id, username: id, passwordHash: "fixture" } });
    await prisma.aiProvider.create({ data: { id: providerId, name: id, apiKey: "", createdBy: id } });
  });
  afterAll(async () => {
    await prisma.aiConversation.deleteMany({ where: { createdBy: id } });
    await prisma.job.deleteMany({ where: { createdBy: id } });
    await prisma.auditLog.deleteMany({ where: { actorId: id } });
    await prisma.playbook.deleteMany({ where: { teamId: id } });
    await prisma.commandTemplate.deleteMany({ where: { teamId: { in: [id, id + "-next"] } } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.team.deleteMany({ where: { id: { in: [id, id + "-next"] } } });
  });
  const open = () => createConversation({ providerId, model: "fixture", hostingEnabled: true }, session);
  async function proposal() {
    const conversation = await open();
    const message = await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "assistant", content: "" } });
    return { conversationId: conversation.id, messageId: message.id, userId: id, session,
      toolCallId: "reused-by-provider", tool: getToolByName("manage_cron")!, args: { action: "pause", taskId: "example" } };
  }

  it("serializes generation admission and invalidates stale writes and pending proposals on clear", async () => {
    const c = await open();
    const reserve = (version: Date) => createMessage({ conversationId: c.id, role: "user", expectedUpdatedAt: version, content: "question" });
    const claims = await Promise.allSettled([reserve(c.updatedAt), reserve(c.updatedAt)]);
    const [winner] = claims.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
    expect(claims.filter((r) => r.status === "rejected")).toHaveLength(1);
    const reply = await withChatGeneration(c.id, winner!.id, (tx) => tx.aiMessage.create({ data: { conversationId: c.id, role: "assistant", content: "first" } }));
    const started = (await getConversationById(c.id, session)).updatedAt;
    await clearConversationMessages(c.id, session);
    await expect(reserve(started)).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await reserve((await getConversationById(c.id, session)).updatedAt);
    await finishChatGeneration(c.id, winner!.id);
    await expect(withChatGeneration(c.id, winner!.id, (tx) => tx.aiMessage.create({ data: { conversationId: c.id, role: "assistant", content: "late" } }))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createHostedAction({ conversationId: c.id, messageId: reply.id, userMessageId: winner!.id, userId: id, session,
      toolCallId: "late", tool: getToolByName("manage_cron")!, args: { action: "pause", taskId: "x" } })).rejects.toMatchObject({ code: "CONFLICT" });
    await withChatGeneration(c.id, next.id, async () => undefined);
    expect((await getConversationById(c.id, session)).messages.map((m) => m.id)).toEqual([next.id]);
    expect(await prisma.aiHostedAction.count({ where: { conversationId: c.id } })).toBe(0);
  });

  it("rolls back an approval card on placeholder failure and correlates repeated provider IDs independently", async () => {
    const input = await proposal();
    const constraint = "placeholder_" + id.replace(/-/g, "");
    await prisma.$executeRawUnsafe(`ALTER TABLE ai_messages ADD CONSTRAINT "${constraint}" CHECK (role <> 'tool' OR "conversationId" <> '${input.conversationId}') NOT VALID`);
    try {
      await expect(createHostedAction(input)).rejects.toThrow();
      expect(await prisma.aiHostedAction.count({ where: { conversationId: input.conversationId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE ai_messages DROP CONSTRAINT "${constraint}"`);
    }
    const [a, b] = await Promise.all([createHostedAction(input), createHostedAction(input)]);
    await rejectHostedAction(b.id, session, "cancel");
    const replies = await prisma.aiMessage.findMany({ where: { conversationId: input.conversationId, role: "tool" } });
    expect(replies).toHaveLength(2);
    expect(JSON.parse(replies.find((m) => m.id === a.id)!.content).status).toBe("PENDING_APPROVAL");
    expect(JSON.parse(replies.find((m) => m.id === b.id)!.content).status).toBe("REJECTED");
  });

  it("consolidates legacy placeholders by action ID without changing their position or another call's reply", async () => {
    const input = await proposal();
    const [legacy, current] = await Promise.all([createHostedAction(input), createHostedAction(input)]);
    const original = await prisma.aiMessage.findUniqueOrThrow({ where: { id: legacy.id } });
    await prisma.aiMessage.delete({ where: { id: legacy.id } });
    const row = { conversationId: original.conversationId, role: "tool", toolCallId: original.toolCallId, content: original.content };
    await prisma.aiMessage.createMany({ data: [
      { ...row, createdAt: original.createdAt }, { ...row, createdAt: new Date(original.createdAt.getTime() + 1) },
    ] });
    await rejectHostedAction(legacy.id, session, "cancel");
    const replies = await prisma.aiMessage.findMany({ where: { conversationId: input.conversationId, role: "tool" } });
    expect(replies).toHaveLength(2);
    const migrated = replies.find((reply) => reply.id === legacy.id)!;
    expect(migrated.createdAt).toEqual(original.createdAt);
    expect(JSON.parse(migrated.content)).toMatchObject({ actionId: legacy.id, status: "REJECTED" });
    expect(JSON.parse(replies.find((reply) => reply.id === current.id)!.content)).toMatchObject({
      actionId: current.id, status: "PENDING_APPROVAL",
    });
  });

  it("locks the parent first when deletion overlaps a claim", async () => {
    const input = await proposal();
    const card = await createHostedAction(input);
    let deletion: Promise<void> | undefined;
    await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid FROM ai_conversations WHERE id = ${input.conversationId} FOR SHARE`;
      deletion = deleteConversation(input.conversationId, session);
      await vi.waitFor(async () => {
        const [waiter] = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ${row!.pid}::integer = ANY(pg_blocking_pids(pid))) AS blocked`;
        expect(waiter?.blocked).toBe(true);
      });
      await tx.$queryRaw`SELECT id FROM ai_hosted_actions WHERE id = ${card.id} FOR UPDATE NOWAIT`;
    });
    await deletion;
    expect(await prisma.aiHostedAction.findUnique({ where: { id: card.id } })).toBeNull();
  });

  it("searches past the original 100 templates and keeps customer scope on tag matches", async () => {
    const template = { command: "uptime", teamId: id, tags: [], variables: [] };
    await prisma.commandTemplate.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ ...template, name: "a-" + i })) });
    await prisma.commandTemplate.createMany({ data: [
      { ...template, name: "z-last", tags: [id] }, { ...template, name: "other", tags: [id], teamId: id + "-next" },
    ] });
    const query = await executeServerlessQuery({ actionType: "list_command_templates", params: { query: id } }, session, "en");
    expect(query?.data).toMatchObject({ count: 1, templates: [{ name: "z-last" }] });
  });

  it("queues exactly the saved Playbook targets shown on the card", async () => {
    const input = await proposal();
    const spec = { id: "step", type: "run_command", name: "read", timeoutSec: 60, retry: 0,
      config: { command: "uptime", serverIds: [id + "-playbook-server"] } };
    const playbook = await prisma.playbook.create({ data: { name: "review", steps: [spec], triggerConfig: {}, triggerType: "cron", teamId: id } });
    const server = await prisma.server.create({ data: { id: spec.config.serverIds[0], name: "target", host: "fixture.test", username: "fixture", teamId: id } });
    try {
      const card = await createHostedAction({ ...input, tool: getToolByName("run_playbook")!, args: { playbookId: playbook.id } });
      expect(JSON.parse(card.params).targetServerIds).toEqual([server.id]);
      await prisma.playbook.update({ where: { id: playbook.id }, data: { steps: [] } });
      await expect(confirmHostedAction(card.id, session)).rejects.toThrow();
      expect(await prisma.playbookRun.count({ where: { playbookId: playbook.id } })).toBe(0);
      await prisma.playbook.update({ where: { id: playbook.id }, data: { steps: [spec] } });
      await confirmHostedAction(card.id, session);
      const run = await prisma.playbookRun.findFirstOrThrow({ where: { playbookId: playbook.id } });
      expect(run.executionState).toMatchObject({ stepsSnapshot: [spec] });
      expect(run.triggerContext).toEqual({ hostedActionId: card.id, source: "ai_hosted_action" });
    } finally {
      await prisma.server.delete({ where: { id: server.id } });
    }
  });

  it("does not enqueue a hosted read after a different customer pairs a fresh Agent on the same server ID", async () => {
    const serverId = id + "-agent";
    await prisma.server.create({ data: {
      id: serverId, name: "agent", host: "fixture.test", username: "fixture", managementMode: "AGENT",
      teamId: id, agentTokenHash: "12".repeat(32), agentLastSeenAt: new Date(),
    } });
    try {
      const completePairing = vi.fn(async () => {
        await prisma.server.update({ where: { id: serverId }, data: {
          teamId: id + "-next", agentTokenHash: "34".repeat(32), agentLastSeenAt: new Date(),
        } });
      });
      const result = await executeSafeAction({ actionType: "get_status", serverId, params: {} }, {
        session, revalidate: completePairing, signal: AbortSignal.timeout(5000),
      });
      expect(completePairing).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ success: false, data: null });
      expect(await prisma.serverAgentJob.count({ where: { serverId } })).toBe(0);
    } finally {
      await prisma.server.delete({ where: { id: serverId } });
    }
  });

  it("shows recorded server identity in history and approvals after a transfer, including legacy cards", async () => {
    const input = await proposal();
    await prisma.server.create({ data: { id, name: "original", host: "original.test", username: "fixture", teamId: id } });
    const card = await createHostedAction({ ...input, tool: getToolByName("execute_command")!, args: { command: "uptime", reason: "inspect", serverId: id } });
    await prisma.server.update({ where: { id }, data: { name: "transferred", host: "new.test", teamId: id + "-next" } });
    const history = () => getConversationById(input.conversationId, session);
    expect((await history()).messages.flatMap((m) => m.hostedActions)[0]?.server).toEqual({ id, name: "original", host: "original.test" });
    expect((await getPendingActions(session)).find((a) => a.id === card.id)?.server?.name).toBe("original");
    await prisma.aiHostedAction.update({ where: { id: card.id }, data: { params: "{}" } });
    expect((await history()).messages.flatMap((m) => m.hostedActions)[0]?.server).toBeNull();
    expect((await getPendingActions(session)).find((a) => a.id === card.id)?.server).toBeNull();
  });
});
