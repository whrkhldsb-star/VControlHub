// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createKnowledgeBase, getKnowledgeBase, ingestKnowledgeDocument, listKnowledgeBases, recoverPendingKnowledgeDocuments, searchKnowledge } from "../knowledge";

/** Past 100 bases the oldest one dropped out of the page, with no way to reach it. */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("knowledge base list (PostgreSQL)", () => {
	const teamId = `kblist-${randomUUID().slice(0, 8)}`;
	const session = { userId: teamId, roles: ["operator"] as never, currentTeamId: teamId };

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId } });
		const base = Date.now() - 86_400_000;
		await prisma.knowledgeBase.createMany({
			data: Array.from({ length: 101 }, (_, i) => ({ id: `${teamId}-${String(i).padStart(3, "0")}`, name: `kb ${i}`, teamId, updatedAt: new Date(base + i * 1000) })),
		});
	});
	afterAll(async () => {
		await prisma.knowledgeBase.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await prisma.$disconnect();
	});

	it("requires a selected customer and quarantines existing unassigned libraries", async () => {
		const admin = { ...session, roles: ["admin" as const], currentTeamId: null };
		await expect(createKnowledgeBase({ name: teamId, session: admin })).rejects.toMatchObject({ code: "FORBIDDEN" });
		const legacy = await prisma.knowledgeBase.create({ data: { name: teamId } });
		try {
			expect(await getKnowledgeBase(legacy.id, admin)).toBeNull();
			await expect(ingestKnowledgeDocument({ knowledgeBaseId: legacy.id, title: "old", content: "text", session: admin })).rejects.toThrow();
		} finally {
			await prisma.knowledgeBase.delete({ where: { id: legacy.id } });
		}
	});

	it("rolls back the document if indexing fails, and returns a fully indexed upload on retry", async () => {
		const baseId = teamId + "-000";
		// Inject a failure at chunk insertion for only this fixture library.
		const constraint = "kb_fixture_" + teamId.replace(/-/g, "_");
		await prisma.$executeRawUnsafe(`ALTER TABLE knowledge_chunks ADD CONSTRAINT "${constraint}" CHECK ("knowledgeBaseId" <> '${baseId}') NOT VALID`);
		const upload = { title: "atomic", content: "index me", knowledgeBaseId: baseId };
		try {
			await expect(ingestKnowledgeDocument(upload)).rejects.toThrow();
			expect(await prisma.knowledgeDocument.count({ where: { knowledgeBaseId: baseId } })).toBe(0);
		} finally {
			await prisma.$executeRawUnsafe(`ALTER TABLE knowledge_chunks DROP CONSTRAINT "${constraint}"`);
		}
		const { document, chunkCount } = await ingestKnowledgeDocument(upload);
		expect(document.status).toBe("READY");
		expect(chunkCount).toBeGreaterThan(0);
		expect(await prisma.knowledgeChunk.count({ where: { documentId: document.id } })).toBe(chunkCount);
	});

	it("recovers pre-upgrade pending uploads exactly once across simultaneous worker starts", async () => {
		const knowledgeBaseId = teamId + "-001";
		const doc = await prisma.knowledgeDocument.create({ data: {
			knowledgeBaseId, title: "old", content: "legacy handover", contentHash: "fixture", status: "PENDING",
		} });
		await Promise.all([recoverPendingKnowledgeDocuments(), recoverPendingKnowledgeDocuments()]);
		expect(await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "READY", chunkCount: 1 });
		expect(await prisma.knowledgeChunk.count({ where: { documentId: doc.id } })).toBe(1);
		expect(await searchKnowledge({ session, knowledgeBaseId, query: "handover" })).toMatchObject([{ documentId: doc.id }]);
	});

	it("lists every active base, the oldest included", async () => {
		const bases = await listKnowledgeBases(session);
		expect(bases).toHaveLength(101);
		expect(bases.at(-1)?.id).toBe(`${teamId}-000`);
	});
});
