import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { customerSession, platformSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	getConversationById: vi.fn(), updateConversation: vi.fn(), deleteConversation: vi.fn(), clearConversationMessages: vi.fn(),
	approveHostedAction: vi.fn(), confirmHostedAction: vi.fn(), rejectHostedAction: vi.fn(),
	fetchModelsFromCredentials: vi.fn(), getAiOpsLog: vi.fn(), approveRecommendation: vi.fn(), auditUserAction: vi.fn(),
	hostedFindUnique: vi.fn(),
}));
vi.mock("@/lib/ai/service", async (original) => {
	const actual = await original<typeof import("@/lib/ai/service")>();
	return { ...actual, getConversationById: mocks.getConversationById, updateConversation: mocks.updateConversation, deleteConversation: mocks.deleteConversation, clearConversationMessages: mocks.clearConversationMessages, serializeConversation: (c: unknown) => c, fetchModelsFromCredentials: mocks.fetchModelsFromCredentials };
});
vi.mock("@/lib/ai/hosted-service", () => ({ approveHostedAction: mocks.approveHostedAction, confirmHostedAction: mocks.confirmHostedAction, rejectHostedAction: mocks.rejectHostedAction }));
vi.mock("@/lib/ai/ops/service", () => ({ getAiOpsLog: mocks.getAiOpsLog, approveRecommendation: mocks.approveRecommendation }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/db", () => ({ prisma: { aiHostedAction: { findUnique: mocks.hostedFindUnique } } }));

const conversation = await import("../conversations/[id]/route");
const hosted = await import("../hosted-actions/[id]/route");
const opsLog = await import("../ops/logs/[id]/route");
const approve = await import("../ops/logs/[id]/approve/route");
const probe = await import("../models/probe/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = Promise.resolve({ id: "c_1" });

describe("AI conversation, hosted action and ops log routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["ai:chat", "ai:ops:read", "ai:ops:manage"]);
		mocks.getConversationById.mockResolvedValue({ id: "c_1", title: "chat" });
		mocks.updateConversation.mockResolvedValue({ id: "c_1", title: "renamed", createdAt: new Date("2026-10-11T00:00:00Z"), updatedAt: new Date("2026-10-11T00:00:00Z") });
		mocks.hostedFindUnique.mockResolvedValue({ id: "c_1", status: "APPROVED" });
		mocks.rejectHostedAction.mockResolvedValue({ id: "c_1", status: "REJECTED" });
		mocks.getAiOpsLog.mockResolvedValue({ id: "c_1" });
		mocks.approveRecommendation.mockResolvedValue({ ok: true });
	});

	it("conversation routes are per user: the owner id always comes from the session", async () => {
		expect(await (await conversation.GET(req("GET", "http://local/api/ai/conversations/c_1"), { params })).json()).toEqual({ conversation: { id: "c_1", title: "chat" } });
		expect(mocks.getConversationById).toHaveBeenCalledWith("c_1", "u_cust");

		const renamed = await conversation.PATCH(req("PATCH", "http://local/api/ai/conversations/c_1", { title: "renamed" }), { params });
		expect(renamed.status).toBe(200);
		expect(mocks.updateConversation).toHaveBeenCalledWith("c_1", "u_cust", expect.objectContaining({ title: "renamed" }));

		await conversation.PATCH(req("PATCH", "http://local/api/ai/conversations/c_1", { clearMessages: true }), { params });
		expect(mocks.clearConversationMessages).toHaveBeenCalledWith("c_1", "u_cust");

		expect((await conversation.DELETE(req("DELETE", "http://local/api/ai/conversations/c_1"), { params })).status).toBe(200);
		expect(mocks.deleteConversation).toHaveBeenCalledWith("c_1", "u_cust");

		mocks.getConversationById.mockRejectedValueOnce(new NotFoundError("missing"));
		expect((await conversation.GET(req("GET", "http://local/api/ai/conversations/c_1"), { params })).status).toBe(404);
		routeSession.current = customerSession([]);
		expect((await conversation.GET(req("GET", "http://local/api/ai/conversations/c_1"), { params })).status).toBe(403);
	});

	it("hosted action decisions delegate their permission checks to the service and audit the decision", async () => {
		expect((await hosted.PATCH(req("PATCH", "http://local/api/ai/hosted-actions/c_1", { action: "approve" }), { params })).status).toBe(200);
		expect(mocks.approveHostedAction).toHaveBeenCalledWith("c_1", expect.objectContaining({ userId: "u_cust" }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "ai.hosted-action.update", { actionId: "c_1", decision: "approve" }, undefined, "team_1");

		const rejected = await hosted.PATCH(req("PATCH", "http://local/api/ai/hosted-actions/c_1", { action: "reject", reason: "no" }), { params });
		expect(await rejected.json()).toEqual({ success: true, action: { id: "c_1", status: "REJECTED" } });
		expect(mocks.rejectHostedAction).toHaveBeenCalledWith("c_1", expect.anything(), "no");

		mocks.confirmHostedAction.mockRejectedValueOnce(new ForbiddenError("needs server:ssh"));
		expect((await hosted.PATCH(req("PATCH", "http://local/api/ai/hosted-actions/c_1", { action: "confirm" }), { params })).status).toBe(403);
		expect((await hosted.PATCH(req("PATCH", "http://local/api/ai/hosted-actions/c_1", { action: "explode" }), { params })).status).toBe(400);
	});

	it("model probing needs ai:manage and validates the credentials body", async () => {
		expect((await probe.POST(req("POST", "http://local/api/ai/models/probe", { type: "OPENAI_COMPATIBLE", baseUrl: "https://api.example.test", apiKey: "k" }))).status).toBe(403);
		routeSession.current = customerSession(["ai:manage"]);
		mocks.fetchModelsFromCredentials.mockResolvedValue([{ id: "gpt" }]);
		const res = await probe.POST(req("POST", "http://local/api/ai/models/probe", { type: "OPENAI_COMPATIBLE", baseUrl: "https://api.example.test", apiKey: "k" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ models: [{ id: "gpt" }] });
		expect((await probe.POST(req("POST", "http://local/api/ai/models/probe", {}))).status).toBe(400);
	});

	it("ops log reads are platform-only and approvals are audited", async () => {
		expect((await opsLog.GET(req("GET", "http://local/api/ai/ops/logs/c_1"), { params })).status).toBe(403);
		routeSession.current = platformSession({ permissions: ["ai:ops:read", "ai:ops:manage"] });
		expect(await (await opsLog.GET(req("GET", "http://local/api/ai/ops/logs/c_1"), { params })).json()).toEqual({ log: { id: "c_1" } });
		mocks.getAiOpsLog.mockResolvedValueOnce(null);
		expect((await opsLog.GET(req("GET", "http://local/api/ai/ops/logs/c_1"), { params })).status).toBe(404);

		const approved = await approve.POST(req("POST", "http://local/api/ai/ops/logs/c_1/approve", { actionId: "a1" }), { params });
		expect(await approved.json()).toEqual({ result: { ok: true } });
		expect(mocks.approveRecommendation).toHaveBeenCalledWith({ logId: "c_1", actionId: "a1" });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "ai.ops.recommendation.approve", expect.objectContaining({ logId: "c_1", actionId: "a1", ok: true }), undefined, null);
	});
});
