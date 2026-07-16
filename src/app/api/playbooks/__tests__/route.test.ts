import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listPlaybooks: vi.fn(),
		createPlaybook: vi.fn(),
		auditUserAction: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/playbook/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/playbook/service")>();
	return {
		...actual,
		listPlaybooks: mocks.listPlaybooks,
		createPlaybook: mocks.createPlaybook,
	};
});
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const validPayload = {
	name: "Cleanup",
	triggerType: "cron",
	triggerConfig: { expression: "0 3 * * *" },
	steps: [
		{
			id: "s1",
			name: "run",
			type: "run_command",
			config: { command: "ls", serverIds: ["srv1"] },
			retry: 0,
			timeoutSec: 60,
		},
	],
	chainRetry: 0,
	enabled: true,
};

describe("/api/playbooks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.listPlaybooks.mockResolvedValue([]);
		mocks.createPlaybook.mockResolvedValue({ id: "pb1", name: "Cleanup", steps: [{ id: "s1" }] });
	});

	it("GET requires playbook:read and returns the playbook list", async () => {
		mocks.listPlaybooks.mockResolvedValue([{ id: "pb1", name: "Cleanup" }]);
		const res = await route.GET(new Request("http://local/api/playbooks"));
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:read");
		expect(json).toEqual({ playbooks: [{ id: "pb1", name: "Cleanup" }] });
	});

	it("POST requires playbook:manage and creates a playbook", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(validPayload),
			}),
		);
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:manage");
		expect(mocks.createPlaybook).toHaveBeenCalledWith(validPayload, "u1", session);
		expect(json.playbook).toEqual({ id: "pb1", name: "Cleanup", steps: [{ id: "s1" }] });
	});

	it("POST returns 400 (ValidationError) when the body is invalid", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "" }),
			}),
		);
		// withApiRoute converts ValidationError → 400 with envelope
		expect(res.status).toBe(400);
		expect(mocks.createPlaybook).not.toHaveBeenCalled();
	});

	it("POST returns 400 when steps are missing", async () => {
		const res = await route.POST(
			new Request("http://local/api/playbooks", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "x",
					triggerType: "cron",
					triggerConfig: { expression: "0 3 * * *" },
					steps: [],
				}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("POST returns 403 when the caller lacks playbook:manage", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.POST(
			new Request("http://local/api/playbooks", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(validPayload),
			}),
		);
		expect(res.status).toBe(403);
	});
});
