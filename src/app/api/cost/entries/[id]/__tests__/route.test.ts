/**
 * TR-031 E01: /api/cost/entries/[id] route tests — get / patch / delete.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		getCostEntry: vi.fn(),
		updateCostEntry: vi.fn(),
		deleteCostEntry: vi.fn(),
		auditUserAction: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/cost/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/cost/service")>();
	return {
		...actual,
		getCostEntry: mocks.getCostEntry,
		updateCostEntry: mocks.updateCostEntry,
		deleteCostEntry: mocks.deleteCostEntry,
	};
});

vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const SAMPLE_ENTRY = {
	id: "ce-1",
	category: "vps" as const,
	provider: "Linode",
	amount: "10.00",
	currency: "CNY" as const,
	effectiveDate: "2026-06-15",
	notes: null,
	createdById: "u1",
	createdAt: "2026-06-15T00:00:00.000Z",
	updatedAt: "2026-06-15T00:00:00.000Z",
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/cost/entries/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.getCostEntry.mockResolvedValue(SAMPLE_ENTRY);
		mocks.updateCostEntry.mockResolvedValue({ ...SAMPLE_ENTRY, amount: "20.00" });
		mocks.deleteCostEntry.mockResolvedValue(undefined);
	});

	it("GET returns the entry when it exists", async () => {
		const res = await route.GET(new Request("http://local/api/cost/entries/ce-1"), ctx("ce-1"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:read");
		const body = await res.json();
		expect(body.entry).toEqual(SAMPLE_ENTRY);
	});

	it("GET returns 404 when the entry is missing", async () => {
		mocks.getCostEntry.mockResolvedValueOnce(null);
		const res = await route.GET(new Request("http://local/api/cost/entries/ce-9"), ctx("ce-9"));
		expect(res.status).toBe(404);
	});

	it("PATCH updates the entry and emits an audit event", async () => {
		const res = await route.PATCH(
			new Request("http://local/api/cost/entries/ce-1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ amount: "20.00", notes: "renewal" }),
			}),
			ctx("ce-1"),
		);
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:manage");
		expect(mocks.updateCostEntry).toHaveBeenCalledWith("ce-1", {
			amount: "20.00",
			notes: "renewal",
		});
		const body = await res.json();
		expect(body.entry).toEqual({ ...SAMPLE_ENTRY, amount: "20.00" });
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"cost.update",
			expect.objectContaining({ entryId: "ce-1" }),
		);
	});

	it("PATCH returns 400 on empty patch", async () => {
		const res = await route.PATCH(
			new Request("http://local/api/cost/entries/ce-1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			}),
			ctx("ce-1"),
		);
		expect(res.status).toBe(400);
		expect(mocks.updateCostEntry).not.toHaveBeenCalled();
	});

	it("PATCH returns 400 on unknown fields", async () => {
		const res = await route.PATCH(
			new Request("http://local/api/cost/entries/ce-1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ amount: "20.00", total: "100" }),
			}),
			ctx("ce-1"),
		);
		expect(res.status).toBe(400);
	});

	it("DELETE removes the entry and emits an audit event", async () => {
		const res = await route.DELETE(new Request("http://local/api/cost/entries/ce-1"), ctx("ce-1"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:manage");
		expect(mocks.deleteCostEntry).toHaveBeenCalledWith("ce-1");
		const body = await res.json();
		expect(body).toEqual({ success: true });
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"cost.delete",
			expect.objectContaining({ entryId: "ce-1" }),
		);
	});
});
