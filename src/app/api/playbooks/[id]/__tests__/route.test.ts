import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		getPlaybook: vi.fn(),
		updatePlaybook: vi.fn(),
		deletePlaybook: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/playbook/service", () => ({
	getPlaybook: mocks.getPlaybook,
	updatePlaybook: mocks.updatePlaybook,
	deletePlaybook: mocks.deletePlaybook,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };
const playbookFixture = { id: "pb1", name: "Cleanup", enabled: true, steps: [{ id: "s1" }] };
const ctx = (id?: string) => ({ params: Promise.resolve({ id }) });

describe("/api/playbooks/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.getPlaybook.mockResolvedValue(playbookFixture);
		mocks.updatePlaybook.mockResolvedValue(playbookFixture);
		mocks.deletePlaybook.mockResolvedValue(playbookFixture);
	});

	it("GET requires playbook:read and returns a single playbook from path params", async () => {
		const res = await route.GET(new Request("http://local/api/playbooks/pb1"), ctx("pb1"));
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:read");
		expect(mocks.getPlaybook).toHaveBeenCalledWith("pb1", session);
		expect(json.playbook).toEqual(playbookFixture);
	});

	it("GET returns 404 when the playbook does not exist", async () => {
		mocks.getPlaybook.mockResolvedValueOnce(null);
		const res = await route.GET(new Request("http://local/api/playbooks/missing"), ctx("missing"));
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.code).toBe("NOT_FOUND");
	});

	it("GET returns 400 when path id is missing", async () => {
		const res = await route.GET(new Request("http://local/api/playbooks/"), ctx(undefined));
		expect(res.status).toBe(400);
		expect(mocks.getPlaybook).not.toHaveBeenCalled();
	});

	it("PATCH requires playbook:manage and updates the playbook using the path id", async () => {
		const updated = { id: "pb1", name: "Cleanup v2", enabled: false, chainRetry: 0 };
		mocks.updatePlaybook.mockResolvedValueOnce({ ...playbookFixture, ...updated });
		const res = await route.PATCH(
			new Request("http://local/api/playbooks/pb1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: "body-id-ignored", name: "Cleanup v2", enabled: false }),
			}),
			ctx("pb1"),
		);
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:manage");
		expect(mocks.updatePlaybook).toHaveBeenCalledWith(updated, "u1", session);
		expect(json.playbook).toMatchObject({ id: "pb1", name: "Cleanup v2" });
	});

	it("DELETE requires playbook:manage and deletes the playbook from path params", async () => {
		const res = await route.DELETE(new Request("http://local/api/playbooks/pb1", { method: "DELETE" }), ctx("pb1"));
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("playbook:manage");
		expect(mocks.deletePlaybook).toHaveBeenCalledWith("pb1", "u1", session);
		expect(json).toEqual({ success: true });
	});

	it("DELETE returns 400 when path id is missing", async () => {
		const res = await route.DELETE(new Request("http://local/api/playbooks/", { method: "DELETE" }), ctx(undefined));
		expect(res.status).toBe(400);
		expect(mocks.deletePlaybook).not.toHaveBeenCalled();
	});

	it("GET returns 403 without playbook:read permission", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.GET(new Request("http://local/api/playbooks/pb1"), ctx("pb1"));
		expect(res.status).toBe(403);
		expect(mocks.getPlaybook).not.toHaveBeenCalled();
	});
});
