// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { type TeamSession } from "@/lib/auth/team-scope";
import {
  clearConversationMessages, createConversation, deleteConversation,
  getConversationById, listConversations, updateConversation,
} from "../service-crud";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("AI conversation customer binding", () => {
  const owner = randomUUID();
  const original: TeamSession = { userId: owner, currentTeamId: "customer-a", roles: ["operator"] };
  const reassigned = { ...original, currentTeamId: "customer-b" };
  const global: TeamSession = { ...original, currentTeamId: null, roles: ["admin"] };
  let providerId: string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: owner, username: owner, passwordHash: "test" } });
    const provider = await prisma.aiProvider.create({ data: { name: "test", apiKey: "fixture", createdBy: owner } });
    providerId = provider.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: owner } });
  });

  it("denies old history and tool output across customer changes, including mutations", async () => {
    const input = { providerId, model: "fixture" };
    const old = await createConversation(input, original);
    await prisma.aiMessage.create({ data: { conversationId: old.id, role: "tool", content: "customer A tool output" } });
    const current = await createConversation(input, reassigned);
    const allCustomers = await createConversation(input, global);
    expect([old.teamId, current.teamId, allCustomers.teamId]).toEqual(["customer-a", "customer-b", null]);
    expect((await listConversations(reassigned)).map((row) => row.id)).toEqual([current.id]);
    expect((await listConversations(global)).map((row) => row.id)).toEqual([allCustomers.id]);
    for (const id of [old.id, allCustomers.id]) {
      await expect(getConversationById(id, reassigned)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(updateConversation(id, reassigned, { title: "new title" })).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(clearConversationMessages(id, reassigned)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(deleteConversation(id, reassigned)).rejects.toMatchObject({ name: "NotFoundError" });
    }
    expect((await getConversationById(old.id, original)).messages).toMatchObject([{ content: "customer A tool output" }]);
    await deleteConversation(old.id, original);
    expect(await prisma.aiMessage.count({ where: { conversationId: old.id } })).toBe(0);
    expect(await listConversations({ ...original, currentTeamId: null })).toEqual([]);
    await expect(createConversation(input, { ...original, currentTeamId: null })).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
