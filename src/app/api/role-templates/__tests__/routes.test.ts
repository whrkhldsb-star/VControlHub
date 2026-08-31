import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the two role-template routes.
 *
 * Role templates hand out permissions, so the split that matters is the one
 * between reading them (`user:read` — the UI needs the catalogue to render role
 * pickers) and writing them (`role:manage`, which only `admin` holds). The
 * service validates permission keys against `ALL_PERMISSIONS` and protects
 * built-ins; that is covered by
 * `src/lib/auth/__tests__/role-template-service.test.ts`. Here we pin the guard
 * options, the audit trail, and that the schema's array caps hold.
 */
const mocks = vi.hoisted(() => ({
	listRoleTemplates: vi.fn(),
	createRoleTemplate: vi.fn(),
	updateRoleTemplate: vi.fn(),
	deleteRoleTemplate: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/role-template-service", async (importOriginal) => {
	// Keep the real zod schema — the array caps are part of this route's contract.
	const actual = await importOriginal<typeof import("@/lib/auth/role-template-service")>();
	return {
		roleTemplateInputSchema: actual.roleTemplateInputSchema,
		listRoleTemplates: mocks.listRoleTemplates,
		createRoleTemplate: mocks.createRoleTemplate,
		updateRoleTemplate: mocks.updateRoleTemplate,
		deleteRoleTemplate: mocks.deleteRoleTemplate,
	};
});
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/db", () => ({
	prisma: {
		role: { findMany: vi.fn(async () => []) },
		storageNode: { findMany: vi.fn(async () => []) },
		roleTemplate: { findMany: vi.fn(async () => []) },
	},
}));

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
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "root",
	roles: ["admin"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const collection = await import("../route");
const item = await import("../[id]/route");

const idParams = { params: Promise.resolve({ id: "tpl_1" }) };

function req(method: string, body?: unknown) {
	return new Request("https://a.test/api/role-templates", {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const templateView = {
	id: "tpl_1",
	name: "storage operator",
	description: null,
	roleKeys: ["operator"],
	permissions: ["storage:read", "storage:write"],
	storageAccess: [],
	isBuiltin: false,
};

describe("role-template routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.listRoleTemplates,
			mocks.createRoleTemplate,
			mocks.updateRoleTemplate,
			mocks.deleteRoleTemplate,
			mocks.auditUserAction,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		mocks.listRoleTemplates.mockResolvedValue([templateView]);
		mocks.createRoleTemplate.mockResolvedValue(templateView);
		mocks.updateRoleTemplate.mockResolvedValue(templateView);
		mocks.deleteRoleTemplate.mockResolvedValue(undefined);
	});

	it("reads the catalogue under user:read with no write limit", async () => {
		const res = await collection.GET(req("GET"));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ templates: [templateView] });
		expect(mocks.guardCalls[0]).toMatchObject({ permission: "user:read" });
		expect(mocks.guardCalls[0]?.rateLimit).toBeUndefined();
	});

	it.each([
		["create", async () => collection.POST(req("POST", { name: "t" }))],
		["patch", async () => item.PATCH(req("PATCH", { name: "t" }), idParams)],
		["delete", async () => item.DELETE(req("DELETE"), idParams)],
	])("%s requires role:manage behind a write limit", async (_label, call) => {
		await call();
		expect(mocks.guardCalls[0]).toMatchObject({
			permission: "role:manage",
			rateLimit: { maxRequests: 30, windowMs: 60_000 },
		});
	});

	it("creates a template, returns 201 and records the author", async () => {
		const res = await collection.POST(
			req("POST", {
				name: "storage operator",
				roleKeys: ["operator"],
				permissions: ["storage:read", "storage:write"],
			}),
		);

		expect(res.status).toBe(201);
		expect(mocks.createRoleTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ name: "storage operator" }),
			"u_1",
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u_1",
			"role_template.create",
			{ templateId: "tpl_1", name: "storage operator" },
			undefined,
			"team_1",
		);
	});

	it("defaults the three collections so a bare name is a valid template", async () => {
		await collection.POST(req("POST", { name: "empty" }));
		expect(mocks.createRoleTemplate).toHaveBeenCalledWith(
			{ name: "empty", roleKeys: [], permissions: [], storageAccess: [] },
			"u_1",
		);
	});

	it.each([
		["a blank name", { name: "" }],
		["a name over 120 chars", { name: "n".repeat(121) }],
		["more than 20 roles", { name: "t", roleKeys: Array.from({ length: 21 }, (_v, i) => `r${i}`) }],
		["more than 500 permissions", { name: "t", permissions: Array.from({ length: 501 }, (_v, i) => `p${i}`) }],
		["more than 100 storage grants", {
			name: "t",
			storageAccess: Array.from({ length: 101 }, () => ({ storageNodeId: "n1" })),
		}],
		["a storage grant with no node", { name: "t", storageAccess: [{ storageNodeId: "" }] }],
	])("rejects %s", async (_label, body) => {
		const res = await collection.POST(req("POST", body));
		expect(res.status).toBe(400);
		expect(mocks.createRoleTemplate).not.toHaveBeenCalled();
	});

	it("keeps the built-in refusal as a 400 on PATCH", async () => {
		const { ValidationError } = await import("@/lib/errors");
		mocks.updateRoleTemplate.mockRejectedValue(
			new ValidationError("built-in templates cannot be modified"),
		);

		const res = await item.PATCH(req("PATCH", { name: "hijack" }), idParams);

		expect(res.status).toBe(400);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});

	it("keeps a missing template as a 404 on PATCH", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.updateRoleTemplate.mockRejectedValue(new NotFoundError("not found"));
		const res = await item.PATCH(req("PATCH", { name: "x" }), idParams);
		expect(res.status).toBe(404);
	});

	it("audits a deletion at WARNING", async () => {
		const res = await item.DELETE(req("DELETE"), idParams);

		expect(res.status).toBe(200);
		expect(mocks.deleteRoleTemplate).toHaveBeenCalledWith("tpl_1");
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u_1",
			"role_template.delete",
			{ templateId: "tpl_1" },
			"WARNING",
			"team_1",
		);
	});
});
