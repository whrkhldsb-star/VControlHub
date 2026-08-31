import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the two knowledge routes.
 *
 * The guard on POST is deliberately the *weaker* of the two permissions
 * (`ai:chat`, so anyone who can chat may search) with a second check inside the
 * handler promoting `create_base`/`ingest` to `ai:manage`. That in-handler check
 * is the only thing standing between a chat user and writing to the knowledge
 * base, so it gets its own cases. Team scoping lives in `@/lib/ai/knowledge`.
 */
const mocks = vi.hoisted(() => ({
	listKnowledgeBases: vi.fn(),
	getKnowledgeBase: vi.fn(),
	createKnowledgeBase: vi.fn(),
	ingestKnowledgeDocument: vi.fn(),
	searchKnowledge: vi.fn(),
	deleteKnowledgeBase: vi.fn(),
	deleteKnowledgeDocument: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/ai/knowledge", () => ({
	listKnowledgeBases: mocks.listKnowledgeBases,
	getKnowledgeBase: mocks.getKnowledgeBase,
	createKnowledgeBase: mocks.createKnowledgeBase,
	ingestKnowledgeDocument: mocks.ingestKnowledgeDocument,
	searchKnowledge: mocks.searchKnowledge,
	deleteKnowledgeBase: mocks.deleteKnowledgeBase,
	deleteKnowledgeDocument: mocks.deleteKnowledgeDocument,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

let currentSession: Record<string, unknown> = {};

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
			body = parsed.data;
		}
		try {
			return await handler({ session: currentSession, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

// `sessionHasPermission` reads `permissions` when present, so these two fixtures
// differ only in whether they may manage the knowledge base.
const chatOnly = {
	userId: "u_1",
	username: "viewer",
	roles: ["viewer"],
	permissions: ["ai:chat"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const manager = {
	userId: "u_2",
	username: "op",
	roles: ["operator"],
	permissions: ["ai:chat", "ai:manage"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const collection = await import("../route");
const item = await import("../[id]/route");

function req(method: string, body?: unknown, query = "") {
	return new Request(`https://a.test/api/knowledge${query}`, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const baseRow = {
	id: "kb_1",
	name: "runbooks",
	description: null,
	isActive: true,
	updatedAt: "2026-08-30T00:00:00.000Z",
	creator: { username: "op" },
	documents: [{ id: "doc_1", title: "nginx" }],
	_count: { documents: 1, chunks: 4 },
};

describe("knowledge routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.listKnowledgeBases,
			mocks.getKnowledgeBase,
			mocks.createKnowledgeBase,
			mocks.ingestKnowledgeDocument,
			mocks.searchKnowledge,
			mocks.deleteKnowledgeBase,
			mocks.deleteKnowledgeDocument,
			mocks.auditUserAction,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		currentSession = manager;
		mocks.listKnowledgeBases.mockResolvedValue([baseRow]);
		mocks.getKnowledgeBase.mockResolvedValue(baseRow);
		mocks.createKnowledgeBase.mockResolvedValue({ id: "kb_1", name: "runbooks" });
		mocks.ingestKnowledgeDocument.mockResolvedValue({
			document: { id: "doc_1", title: "nginx" },
			chunkCount: 4,
		});
		mocks.searchKnowledge.mockResolvedValue([{ documentId: "doc_1", score: 0.9 }]);
		mocks.deleteKnowledgeBase.mockResolvedValue({ id: "kb_1" });
		mocks.deleteKnowledgeDocument.mockResolvedValue({ id: "doc_1" });
	});

	describe("guard contract", () => {
		it("lists under ai:chat", async () => {
			await collection.GET(req("GET"));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "ai:chat",
				rateLimit: { maxRequests: 120, windowMs: 60_000 },
			});
		});

		it("posts under ai:chat so search stays available to chat users", async () => {
			await collection.POST(req("POST", { action: "search", query: "nginx" }));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "ai:chat",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("deletes under ai:manage", async () => {
			await collection.DELETE(req("DELETE", undefined, "?id=kb_1"));
			expect(mocks.guardCalls[0]).toMatchObject({ permission: "ai:manage" });
		});
	});

	describe("in-handler ai:manage promotion", () => {
		it.each([
			["create_base", { action: "create_base", name: "runbooks" }],
			["ingest", { action: "ingest", knowledgeBaseId: "kb_1", title: "t", content: "c" }],
		])("403s %s for a chat-only session", async (_label, body) => {
			currentSession = chatOnly;

			const res = await collection.POST(req("POST", body));

			expect(res.status).toBe(403);
			expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
			expect(mocks.ingestKnowledgeDocument).not.toHaveBeenCalled();
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("still lets a chat-only session search", async () => {
			currentSession = chatOnly;

			const res = await collection.POST(req("POST", { action: "search", query: "nginx" }));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ hits: [{ documentId: "doc_1", score: 0.9 }], count: 1 });
			expect(mocks.searchKnowledge).toHaveBeenCalledWith(
				expect.objectContaining({ query: "nginx", session: chatOnly }),
			);
		});
	});

	describe("actions", () => {
		it("creates a base with 201 and audits it", async () => {
			const res = await collection.POST(req("POST", { action: "create_base", name: "runbooks" }));

			expect(res.status).toBe(201);
			expect(mocks.createKnowledgeBase).toHaveBeenCalledWith(
				expect.objectContaining({ name: "runbooks", session: manager }),
			);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"knowledge.base.create",
				{ knowledgeBaseId: "kb_1", name: "runbooks" },
				undefined,
				"team_1",
			);
		});

		it("ingests a document with 201 and reports the chunk count", async () => {
			const res = await collection.POST(
				req("POST", { action: "ingest", knowledgeBaseId: "kb_1", title: "nginx", content: "body" }),
			);

			expect(res.status).toBe(201);
			expect(await res.json()).toEqual({ document: { id: "doc_1", title: "nginx" }, chunkCount: 4 });
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"knowledge.document.ingest",
				{ knowledgeBaseId: "kb_1", documentId: "doc_1", chunkCount: 4 },
				undefined,
				"team_1",
			);
		});

		it.each([
			["an unknown action", { action: "summarise" }],
			["a create with no name", { action: "create_base", name: "" }],
			["an ingest with no content", { action: "ingest", knowledgeBaseId: "kb_1", title: "t", content: "" }],
			["an ingest over the content cap", {
				action: "ingest",
				knowledgeBaseId: "kb_1",
				title: "t",
				content: "x".repeat(200_001),
			}],
			["a search with a blank query", { action: "search", query: "" }],
			["a search limit above 8", { action: "search", query: "q", limit: 9 }],
		])("rejects %s", async (_label, body) => {
			const res = await collection.POST(req("POST", body));
			expect(res.status).toBe(400);
			expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
			expect(mocks.ingestKnowledgeDocument).not.toHaveBeenCalled();
			expect(mocks.searchKnowledge).not.toHaveBeenCalled();
		});
	});

	describe("DELETE", () => {
		it("deletes a document when documentId wins over id", async () => {
			const res = await collection.DELETE(req("DELETE", undefined, "?id=kb_1&documentId=doc_1"));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ success: true, documentId: "doc_1" });
			expect(mocks.deleteKnowledgeDocument).toHaveBeenCalledWith("doc_1", manager);
			expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
		});

		it("deletes a base when only id is given", async () => {
			const res = await collection.DELETE(req("DELETE", undefined, "?id=kb_1"));

			expect(res.status).toBe(200);
			expect(mocks.deleteKnowledgeBase).toHaveBeenCalledWith("kb_1", manager);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"knowledge.base.delete",
				{ knowledgeBaseId: "kb_1" },
				undefined,
				"team_1",
			);
		});

		it("400s when neither id nor documentId is given", async () => {
			const res = await collection.DELETE(req("DELETE"));
			expect(res.status).toBe(400);
			expect(mocks.deleteKnowledgeBase).not.toHaveBeenCalled();
			expect(mocks.deleteKnowledgeDocument).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/knowledge/[id]", () => {
		it("returns the base with its documents", async () => {
			const res = await item.GET(req("GET"), { params: Promise.resolve({ id: "kb_1" }) });
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.knowledgeBase).toEqual({
				id: "kb_1",
				name: "runbooks",
				description: null,
				isActive: true,
				documentCount: 1,
				chunkCount: 4,
				documents: [{ id: "doc_1", title: "nginx" }],
				updatedAt: "2026-08-30T00:00:00.000Z",
			});
			expect(mocks.getKnowledgeBase).toHaveBeenCalledWith("kb_1", manager);
		});

		it("404s a base outside the caller's scope", async () => {
			mocks.getKnowledgeBase.mockResolvedValue(null);
			const res = await item.GET(req("GET"), { params: Promise.resolve({ id: "kb_other" }) });
			expect(res.status).toBe(404);
		});
	});
});
