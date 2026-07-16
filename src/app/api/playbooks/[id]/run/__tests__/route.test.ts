import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		runPlaybook: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/playbook/service", () => ({
	runPlaybook: mocks.runPlaybook,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };
const ctx = (id?: string) => ({ params: Promise.resolve({ id }) });

describe("/api/playbooks/[id]/run POST", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.runPlaybook.mockResolvedValue({ id: "run1", playbookId: "pb1", status: "RUNNING" });
	});

	it("runs a playbook from path params and returns the run object", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks/pb1/run", { method: "POST" }),
			ctx("pb1"),
		);
		const json = await res.json();
		expect(res.status).toBe(202);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:run");
		expect(mocks.runPlaybook).toHaveBeenCalledWith(
			expect.objectContaining({
				playbookId: "pb1",
				dryRun: false,
				createdById: "u1",
			}),
		);
		expect(json.run).toMatchObject({ id: "run1", playbookId: "pb1" });
	});

	it("returns 404 when the playbook does not exist", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.runPlaybook.mockRejectedValueOnce(new NotFoundError("playbook 不存在"));
		const res = await route.POST(
			new Request("http://local/api/playbooks/missing/run", { method: "POST" }),
			ctx("missing"),
		);
		expect(res.status).toBe(404);
	});

	it("returns 422 when the playbook is disabled", async () => {
		const { BusinessError } = await import("@/lib/errors");
		mocks.runPlaybook.mockRejectedValueOnce(new BusinessError("playbook is disabled: pb1"));
		const res = await route.POST(
			new Request("http://local/api/playbooks/pb1/run", { method: "POST" }),
			ctx("pb1"),
		);
		expect(res.status).toBe(422);
	});

	it("returns 400 when path id is missing", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks//run", { method: "POST" }),
			ctx(undefined),
		);
		expect(res.status).toBe(400);
		expect(mocks.runPlaybook).not.toHaveBeenCalled();
	});

	it("returns 403 when the caller lacks playbook:run permission", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.POST(
			new Request("http://local/api/playbooks/pb1/run", { method: "POST" }),
			ctx("pb1"),
		);
		expect(res.status).toBe(403);
		expect(mocks.runPlaybook).not.toHaveBeenCalled();
	});
});
