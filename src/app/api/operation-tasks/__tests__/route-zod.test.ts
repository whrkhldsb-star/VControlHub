import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TR-037 R5+ validation tests for the new zod schema on
 * `/api/operation-tasks`. The pre-existing happy-path tests live in
 * `route.test.ts`; this file exercises the failure paths introduced
 * by the zod wrapper (NaN limit, unknown format, oversized status).
 */

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listOperationTaskResult: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/operation-task/service", () => ({
	listOperationTaskResult: mocks.listOperationTaskResult,
}));

const route = await import("../route");

describe("/api/operation-tasks zod validation (TR-037 R5+)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" } });
		mocks.listOperationTaskResult.mockResolvedValue({
			tasks: [],
			sourceSummary: [],
			failureSummary: [],
		});
	});

	it("rejects a non-numeric limit with 400 instead of silently coercing to NaN", async () => {
		const response = await route.GET(
			new Request("http://local/api/operation-tasks?limit=abc"),
		);

		expect(response.status).toBe(400);
		// The route should never reach the service when input fails validation.
		expect(mocks.listOperationTaskResult).not.toHaveBeenCalled();
	});

	it("rejects an oversized limit with 400", async () => {
		const response = await route.GET(
			new Request("http://local/api/operation-tasks?limit=99999"),
		);

		expect(response.status).toBe(400);
		expect(mocks.listOperationTaskResult).not.toHaveBeenCalled();
	});

	it("rejects an unknown format with 400 (was: silently JSON before R5+)", async () => {
		const response = await route.GET(
			new Request("http://local/api/operation-tasks?format=xml"),
		);

		expect(response.status).toBe(400);
		expect(mocks.listOperationTaskResult).not.toHaveBeenCalled();
	});

	it("rejects an oversized status CSV (max 256 chars)", async () => {
		const huge = "pending,".repeat(40); // 320 chars
		const response = await route.GET(
			new Request(`http://local/api/operation-tasks?status=${huge}`),
		);

		expect(response.status).toBe(400);
		expect(mocks.listOperationTaskResult).not.toHaveBeenCalled();
	});

	it("still resolves empty ?limit= to undefined (legacy contract)", async () => {
		const response = await route.GET(
			new Request("http://local/api/operation-tasks?limit="),
		);

		expect(response.status).toBe(200);
		expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
			{ limit: undefined, status: undefined, taskType: undefined, sort: undefined },
			{ userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
		);
	});

	it("still drops unknown status tokens silently inside the handler (legacy contract)", async () => {
		const response = await route.GET(
			new Request(
				"http://local/api/operation-tasks?status=garbage,pending,another",
			),
		);

		expect(response.status).toBe(200);
		expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
			{ limit: undefined, status: "pending", taskType: undefined, sort: undefined },
			{ userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
		);
	});

	it("still drops unknown sort values silently inside the handler (legacy contract)", async () => {
		const response = await route.GET(
			new Request("http://local/api/operation-tasks?sort=oldest"),
		);

		expect(response.status).toBe(200);
		expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
			{ limit: undefined, status: undefined, taskType: undefined, sort: undefined },
			{ userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
		);
	});
});
