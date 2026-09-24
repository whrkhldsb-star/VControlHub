import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Contract tests for the four `/api/snippets` methods.
 *
 * Snippets are **user-scoped, not team-scoped** by design: the model carries no
 * `teamId`, and ownership is enforced through `createdBy` + `isPrivate` inside
 * the service (covered by `src/lib/snippet/__tests__/service.test.ts`). What the
 * route layer owns — and what these tests pin — is the `actor` it hands that
 * service:
 *
 *   { userId, canManageAll: sessionHasPermission(session, "role:manage") }
 *
 * `snippet:manage` alone must NOT set `canManageAll`; that flag is the override
 * that lets someone edit and delete other people's snippets, and it is gated on
 * the far narrower `role:manage`. Since `snippet:manage` is a default `operator`
 * permission, conflating the two would hand every operator write access to every
 * private snippet in the install.
 *
 * The second property is error mapping: service AppErrors bubble straight to
 * the guard's `apiCatch`, which keeps each AppError's own status (the route's
 * own comment says it: "do not string-match English messages — messages are
 * not stable error codes").
 */
const mocks = vi.hoisted(() => ({
	listSnippets: vi.fn(),
	getSnippet: vi.fn(),
	createSnippet: vi.fn(),
	updateSnippet: vi.fn(),
	deleteSnippet: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/snippet/service", () => ({
	listSnippets: mocks.listSnippets,
	getSnippet: mocks.getSnippet,
	createSnippet: mocks.createSnippet,
	updateSnippet: mocks.updateSnippet,
	deleteSnippet: mocks.deleteSnippet,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
			body = parsed.data;
		}
		let query: unknown = undefined;
		if (options.querySchema) {
			const url = new URL(request.url);
			const parsed = options.querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
			if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
			query = parsed.data;
		}
		try {
			return await handler({ session, body, query });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

/**
 * Mutable so a test can narrow the permission set. `sessionHasPermission` reads
 * `session.permissions` when it is an array, so the fixture grants exactly the
 * permission under test rather than relying on whatever the `operator` role
 * happens to carry today.
 */
const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	permissions: ["snippet:manage"] as string[],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const route = await import("../route");

const snippetView = {
	id: "sn_1",
	title: "restart nginx",
	content: "systemctl restart nginx",
	language: "bash",
	description: null,
	tags: ["ops"],
	isPrivate: false,
	createdBy: "u_1",
};

function req(method: string, body?: unknown, url = "https://a.test/api/snippets") {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("/api/snippets routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.guardCalls.length = 0;
		session.permissions = ["snippet:manage"];
		session.currentTeamId = "team_1";
		// `mockResolvedValue` is an implementation, not a call record — clearAllMocks
		// leaves it in place, so re-seed (and mockReset the rejecting ones) here.
		mocks.listSnippets.mockReset();
		mocks.getSnippet.mockReset();
		mocks.createSnippet.mockReset();
		mocks.updateSnippet.mockReset();
		mocks.deleteSnippet.mockReset();
		mocks.listSnippets.mockResolvedValue([]);
		mocks.getSnippet.mockResolvedValue(snippetView);
		mocks.createSnippet.mockResolvedValue(snippetView);
		mocks.updateSnippet.mockResolvedValue(snippetView);
		mocks.deleteSnippet.mockResolvedValue(snippetView);
	});

	describe("guard options", () => {
		it("gates all four methods on snippet:manage", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { title: "t", content: "c" }));
			await route.PATCH(req("PATCH", { id: "sn_1", title: "t" }));
			await route.DELETE(req("DELETE", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(mocks.guardCalls.map((o) => o.permission)).toEqual([
				"snippet:manage",
				"snippet:manage",
				"snippet:manage",
				"snippet:manage",
			]);
		});

		it("rate-limits the three write methods but not the read", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { title: "t", content: "c" }));
			await route.PATCH(req("PATCH", { id: "sn_1", title: "t" }));
			await route.DELETE(req("DELETE", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(mocks.guardCalls.map((o) => Boolean(o.rateLimit))).toEqual([false, true, true, true]);
		});
	});

	describe("GET — list", () => {
		it("scopes the list to the caller so private snippets stay private", async () => {
			const res = await route.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(mocks.listSnippets).toHaveBeenCalledWith({
				userId: "u_1",
				q: undefined,
				language: undefined,
			});
			expect(mocks.getSnippet).not.toHaveBeenCalled();
		});

		it("forwards the q and language filters", async () => {
			await route.GET(req("GET", undefined, "https://a.test/api/snippets?q=nginx&language=bash"));
			expect(mocks.listSnippets).toHaveBeenCalledWith({
				userId: "u_1",
				q: "nginx",
				language: "bash",
			});
		});

		it("returns the rows under a `snippets` key", async () => {
			mocks.listSnippets.mockResolvedValue([{ id: "sn_1", contentPreview: "sys…" }]);
			const res = await route.GET(req("GET"));
			await expect(res.json()).resolves.toEqual({ snippets: [{ id: "sn_1", contentPreview: "sys…" }] });
		});

		it("rejects a blank q rather than treating it as 'match everything'", async () => {
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?q=%20%20"));
			expect(res.status).toBe(400);
			expect(mocks.listSnippets).not.toHaveBeenCalled();
		});
	});

	describe("GET — single by id", () => {
		it("switches to getSnippet and does not list", async () => {
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ snippet: snippetView });
			expect(mocks.listSnippets).not.toHaveBeenCalled();
		});

		it("does not grant canManageAll from snippet:manage alone", async () => {
			await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(mocks.getSnippet).toHaveBeenCalledWith("sn_1", { userId: "u_1", canManageAll: false });
		});

		it("grants canManageAll only to a role:manage holder", async () => {
			session.permissions = ["snippet:manage", "role:manage"];
			await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(mocks.getSnippet).toHaveBeenCalledWith("sn_1", { userId: "u_1", canManageAll: true });
		});

		it("maps a private-snippet refusal to 403, not 500", async () => {
			mocks.getSnippet.mockRejectedValue(new ForbiddenError("no permission"));
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_9"));
			expect(res.status).toBe(403);
		});

		it("maps a missing snippet to 404", async () => {
			mocks.getSnippet.mockRejectedValue(new NotFoundError("snippet not found"));
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_9"));
			expect(res.status).toBe(404);
		});

		it("masks an unexpected read failure as 500 without leaking the message", async () => {
			mocks.getSnippet.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.9:5432"));
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(res.status).toBe(500);
			const payload = (await res.json()) as { message?: string };
			expect(payload.message ?? "").not.toContain("ECONNREFUSED");
		});

		it("rejects a blank id instead of falling through to the list branch", async () => {
			const res = await route.GET(req("GET", undefined, "https://a.test/api/snippets?id=%20"));
			expect(res.status).toBe(400);
			expect(mocks.getSnippet).not.toHaveBeenCalled();
			expect(mocks.listSnippets).not.toHaveBeenCalled();
		});
	});

	describe("POST", () => {
		it("stamps the caller as createdBy and audits with the team", async () => {
			const res = await route.POST(req("POST", { title: "restart nginx", content: "systemctl restart nginx", language: "bash" }));
			expect(res.status).toBe(201);
			expect(mocks.createSnippet).toHaveBeenCalledWith({
				title: "restart nginx",
				content: "systemctl restart nginx",
				language: "bash",
				createdBy: "u_1",
			});
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"snippet.create",
				{ snippetId: "sn_1" },
				undefined,
				"team_1",
			);
		});

		it("ignores a client-supplied createdBy", async () => {
			// `createdBy` is not in the schema, so zod strips it before the spread —
			// otherwise `{ ...body, createdBy: session.userId }` order would decide
			// authorship and a caller could forge someone else's snippet.
			await route.POST(req("POST", { title: "t", content: "c", createdBy: "u_victim" }));
			expect(mocks.createSnippet).toHaveBeenCalledWith({ title: "t", content: "c", createdBy: "u_1" });
		});

		it("rejects a missing title", async () => {
			const res = await route.POST(req("POST", { content: "c" }));
			expect(res.status).toBe(400);
			expect(mocks.createSnippet).not.toHaveBeenCalled();
		});

		it("rejects an empty content", async () => {
			const res = await route.POST(req("POST", { title: "t", content: "" }));
			expect(res.status).toBe(400);
		});

		it("rejects a title over 120 characters", async () => {
			const res = await route.POST(req("POST", { title: "x".repeat(121), content: "c" }));
			expect(res.status).toBe(400);
		});

		it("rejects more than 20 tags", async () => {
			const res = await route.POST(req("POST", {
				title: "t",
				content: "c",
				tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
			}));
			expect(res.status).toBe(400);
		});

		it("rejects a description over 500 characters", async () => {
			const res = await route.POST(req("POST", { title: "t", content: "c", description: "x".repeat(501) }));
			expect(res.status).toBe(400);
		});
	});

	describe("PATCH", () => {
		it("strips id from the update payload and passes the actor", async () => {
			const res = await route.PATCH(req("PATCH", { id: "sn_1", title: "new title", isPrivate: true }));
			expect(res.status).toBe(200);
			expect(mocks.updateSnippet).toHaveBeenCalledWith(
				"sn_1",
				{ title: "new title", isPrivate: true },
				{ userId: "u_1", canManageAll: false },
			);
		});

		it("promotes the actor to canManageAll for a role:manage holder", async () => {
			session.permissions = ["snippet:manage", "role:manage"];
			await route.PATCH(req("PATCH", { id: "sn_1", title: "new" }));
			expect(mocks.updateSnippet).toHaveBeenCalledWith(
				"sn_1",
				{ title: "new" },
				{ userId: "u_1", canManageAll: true },
			);
		});

		it("rejects an update that names no field", async () => {
			const res = await route.PATCH(req("PATCH", { id: "sn_1" }));
			expect(res.status).toBe(400);
			expect(mocks.updateSnippet).not.toHaveBeenCalled();
		});

		it("maps someone else's snippet to 403 and writes no audit entry", async () => {
			mocks.updateSnippet.mockRejectedValue(new ForbiddenError("no permission to modify"));
			const res = await route.PATCH(req("PATCH", { id: "sn_2", title: "hijack" }));
			expect(res.status).toBe(403);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("maps a blank title rejected by the service to 400", async () => {
			mocks.updateSnippet.mockRejectedValue(new ValidationError("Snippet title cannot be empty"));
			const res = await route.PATCH(req("PATCH", { id: "sn_1", isPrivate: false }));
			expect(res.status).toBe(400);
		});

		it("maps a vanished snippet to 404", async () => {
			mocks.updateSnippet.mockRejectedValue(new NotFoundError("snippet not found"));
			const res = await route.PATCH(req("PATCH", { id: "sn_9", title: "x" }));
			expect(res.status).toBe(404);
		});

		it("audits the update against the caller's team", async () => {
			await route.PATCH(req("PATCH", { id: "sn_1", title: "new" }));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"snippet.update",
				{ snippetId: "sn_1" },
				undefined,
				"team_1",
			);
		});
	});

	describe("DELETE", () => {
		it("deletes by query id with the actor and audits", async () => {
			const res = await route.DELETE(req("DELETE", undefined, "https://a.test/api/snippets?id=sn_1"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ success: true });
			expect(mocks.deleteSnippet).toHaveBeenCalledWith("sn_1", { userId: "u_1", canManageAll: false });
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"snippet.delete",
				{ snippetId: "sn_1" },
				undefined,
				"team_1",
			);
		});

		it("rejects a request with no id", async () => {
			const res = await route.DELETE(req("DELETE"));
			expect(res.status).toBe(400);
			expect(mocks.deleteSnippet).not.toHaveBeenCalled();
		});

		it("maps someone else's snippet to 403 and writes no audit entry", async () => {
			mocks.deleteSnippet.mockRejectedValue(new ForbiddenError("no permission to delete"));
			const res = await route.DELETE(req("DELETE", undefined, "https://a.test/api/snippets?id=sn_2"));
			expect(res.status).toBe(403);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("maps a missing snippet to 404", async () => {
			mocks.deleteSnippet.mockRejectedValue(new NotFoundError("snippet not found"));
			const res = await route.DELETE(req("DELETE", undefined, "https://a.test/api/snippets?id=sn_9"));
			expect(res.status).toBe(404);
		});
	});
});
