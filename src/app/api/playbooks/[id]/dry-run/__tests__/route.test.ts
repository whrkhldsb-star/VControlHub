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

describe("/api/playbooks/[id]/dry-run POST", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.runPlaybook.mockResolvedValue({ id: "run1", playbookId: "pb1", status: "SUCCESS", dryRun: true });
	});

	it("requires playbook:run permission and returns the dry-run object", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks/pb1/dry-run?id=pb1", { method: "POST" }),
		);
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:run");
		expect(mocks.runPlaybook).toHaveBeenCalledWith(
			expect.objectContaining({
				playbookId: "pb1",
				dryRun: true,
				createdById: "u1",
			}),
		);
		expect(json.run).toMatchObject({ id: "run1", playbookId: "pb1", dryRun: true });
	});

	it("passes a dry-run trigger context with source 'dry-run'", async () => {
		await route.POST(
			new Request("http://local/api/playbooks/pb1/dry-run?id=pb1", { method: "POST" }),
		);
		expect(mocks.runPlaybook).toHaveBeenCalledWith(
			expect.objectContaining({
				triggerContext: expect.objectContaining({ source: "dry-run" }),
			}),
		);
	});

	it("returns 400 when id query param is missing", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks//dry-run", { method: "POST" }),
		);
		expect(res.status).toBe(400);
		expect(mocks.runPlaybook).not.toHaveBeenCalled();
	});

	it("returns 403 when the caller lacks playbook:run permission", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.POST(
			new Request("http://local/api/playbooks/pb1/dry-run?id=pb1", { method: "POST" }),
		);
		expect(res.status).toBe(403);
		expect(mocks.runPlaybook).not.toHaveBeenCalled();
	});

	it("returns 404 when the playbook does not exist", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.runPlaybook.mockRejectedValueOnce(new NotFoundError("playbook 不存在"));
		const res = await route.POST(
			new Request("http://local/api/playbooks/missing/dry-run?id=missing", { method: "POST" }),
		);
		expect(res.status).toBe(404);
	});
});
