import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		createDeploymentRollbackRun: vi.fn(),
		auditUserAction: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/deployment/service", () => ({
	createDeploymentRollbackRun: mocks.createDeploymentRollbackRun,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

describe("/api/deployments/[id]/rollback POST", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.createDeploymentRollbackRun.mockResolvedValue({
			id: "rb1",
			commandRequestId: "cmd1",
			status: "PENDING",
		});
	});

	it("creates a rollback run and returns 201", async () => {
		const res = await route.POST(
			new Request("http://local/api/deployments/dep1/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: "bad deploy" }),
			}),
			{ params: Promise.resolve({ id: "dep1" }) },
		);
		const json = await res.json();
		expect(res.status).toBe(201);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("deploy:run");
		expect(mocks.createDeploymentRollbackRun).toHaveBeenCalledWith({
			sourceRunId: "dep1",
			requesterId: "u1",
			reason: "bad deploy",
		});
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"deployment.rollback",
			expect.objectContaining({ sourceRunId: "dep1", rollbackId: "rb1", reason: "bad deploy" }),
		);
		expect(json.rollback).toMatchObject({ id: "rb1", commandRequestId: "cmd1" });
	});

	it("returns 404 when the source run does not exist", async () => {
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new Error("部署运行不存在"));
		const res = await route.POST(
			new Request("http://local/api/deployments/missing/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: "rollback" }),
			}),
			{ params: Promise.resolve({ id: "missing" }) },
		);
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.code).toBe("NOT_FOUND");
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});

	it("returns 400 when the snapshot has no rollback command", async () => {
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new Error("该部署快照没有回滚命令"));
		const res = await route.POST(
			new Request("http://local/api/deployments/dep1/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: "fix" }),
			}),
			{ params: Promise.resolve({ id: "dep1" }) },
		);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.code).toBe("BUSINESS_RULE_FAILED");
	});

	it("returns 400 when the deployment has no snapshot", async () => {
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new Error("该部署没有可回滚快照"));
		const res = await route.POST(
			new Request("http://local/api/deployments/dep1/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			}),
			{ params: Promise.resolve({ id: "dep1" }) },
		);
		expect(res.status).toBe(400);
	});

	it("returns 403 when the caller lacks deploy:run permission", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.POST(
			new Request("http://local/api/deployments/dep1/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: "rollback" }),
			}),
			{ params: Promise.resolve({ id: "dep1" }) },
		);
		expect(res.status).toBe(403);
		expect(mocks.createDeploymentRollbackRun).not.toHaveBeenCalled();
	});

	it("returns 500 for unexpected errors", async () => {
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new Error("database down"));
		const res = await route.POST(
			new Request("http://local/api/deployments/dep1/rollback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: "rollback" }),
			}),
			{ params: Promise.resolve({ id: "dep1" }) },
		);
		expect(res.status).toBe(500);
	});
});
