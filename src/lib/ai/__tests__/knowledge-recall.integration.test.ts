// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { buildKnowledgeContextForPrompt, searchKnowledge } from "../knowledge";

/**
 * Candidate recall must follow relevance, not age: one old SOP that matches
 * every query term sits behind 250 newer chunks that only share one common
 * word. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("knowledge search candidate recall", () => {
  const prefix = `kb-recall-${randomUUID()}`;
  const session = { userId: prefix, roles: ["operator" as const], currentTeamId: prefix };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    const base = await prisma.knowledgeBase.create({ data: { name: prefix, teamId: prefix } });
    const old = await prisma.knowledgeDocument.create({
      data: { knowledgeBaseId: base.id, title: "Nginx reload SOP", content: "x", contentHash: `${prefix}-old`, status: "READY" },
    });
    await prisma.knowledgeChunk.create({
      data: {
        knowledgeBaseId: base.id,
        documentId: old.id,
        chunkIndex: 0,
        content: "SOP: reload nginx gracefully with nginx -s reload after certbot renewal; never restart.",
        searchText: "sop: reload nginx gracefully with nginx -s reload after certbot renewal; never restart.",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    });
    const noise = await prisma.knowledgeDocument.create({
      data: { knowledgeBaseId: base.id, title: "Access logs", content: "x", contentHash: `${prefix}-noise`, status: "READY" },
    });
    await prisma.knowledgeChunk.createMany({
      data: Array.from({ length: 250 }, (_, index) => ({
        knowledgeBaseId: base.id,
        documentId: noise.id,
        chunkIndex: index,
        content: `nginx access log line ${index}`,
        searchText: `nginx access log line ${index}`,
        createdAt: new Date(Date.parse("2026-06-01T00:00:00Z") + index * 1000),
      })),
    });
  });

  afterAll(async () => {
    await prisma.knowledgeBase.deleteMany({ where: { teamId: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("returns the old highly relevant chunk first despite 250 newer partial matches", async () => {
    const hits = await searchKnowledge({ query: "nginx reload certbot renewal", session });
    expect(hits[0]).toMatchObject({ documentTitle: "Nginx reload SOP", chunkIndex: 0 });
  });

  it("still finds the newer chunks for a query only they match", async () => {
    const hits = await searchKnowledge({ query: "access log line 249", session, limit: 3 });
    expect(hits[0]?.content).toBe("nginx access log line 249");
  });

  it("uses the platform's per-answer excerpt budget when the caller sets no limit", async () => {
    // Default ai.knowledgeMaxResults is 8; the chat path passes no limit.
    expect((await buildKnowledgeContextForPrompt({ query: "nginx", session })).hits).toHaveLength(8);
    await prisma.setting.upsert({ where: { key: "ai.knowledgeMaxResults" }, create: { key: "ai.knowledgeMaxResults", value: "12" }, update: { value: "12" } });
    try {
      expect((await buildKnowledgeContextForPrompt({ query: "nginx", session })).hits).toHaveLength(12);
      // A caller may still ask for fewer, never for more.
      expect(await searchKnowledge({ query: "nginx", session, limit: 3 })).toHaveLength(3);
      expect(await searchKnowledge({ query: "nginx", session, limit: 50 })).toHaveLength(12);
    } finally {
      await prisma.setting.deleteMany({ where: { key: "ai.knowledgeMaxResults" } });
    }
  });

  it("treats LIKE wildcards in the query literally", async () => {
    const hits = await searchKnowledge({ query: "ng_nx %%", session });
    expect(hits).toEqual([]);
  });

  it("does not return another customer's knowledge", async () => {
    const hits = await searchKnowledge({ query: "nginx reload", session: { ...session, currentTeamId: `${prefix}-other` } });
    expect(hits).toEqual([]);
  });
});
