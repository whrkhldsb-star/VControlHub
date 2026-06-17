/**
 * TR-031 E01: /api/cost/entries route tests — list + create.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listCostEntries: vi.fn(),
		createCostEntry: vi.fn(),
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
		listCostEntries: mocks.listCostEntries,
		createCostEntry: mocks.createCostEntry,
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

describe("/api/cost/entries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.listCostEntries.mockResolvedValue([SAMPLE_ENTRY]);
		mocks.createCostEntry.mockResolvedValue(SAMPLE_ENTRY);
	});

	it("GET requires cost:read and returns the entry list", async () => {
		const res = await route.GET(new Request("http://local/api/cost/entries"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:read");
		const body = await res.json();
		expect(body.entries).toEqual([SAMPLE_ENTRY]);
	});

	it("GET forwards month and category filters to the service", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/entries?month=2026-06&category=storage"),
		);
		expect(res.status).toBe(200);
		expect(mocks.listCostEntries).toHaveBeenCalledWith({
			month: "2026-06",
			category: "storage",
			limit: undefined,
		});
	});

	it("GET returns 400 when category is invalid", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/entries?category=oops"),
		);
		expect(res.status).toBe(400);
		expect(mocks.listCostEntries).not.toHaveBeenCalled();
	});

	it("POST requires cost:manage and creates a cost entry", async () => {
		const res = await route.POST(
			new Request("http://local/api/cost/entries", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "bandwidth",
					provider: "Cloudflare",
					amount: "5.50",
					effectiveDate: "2026-06-10",
				}),
			}),
		);
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:manage");
		expect(mocks.createCostEntry).toHaveBeenCalledWith(
			{
				category: "bandwidth",
				provider: "Cloudflare",
				amount: "5.50",
				effectiveDate: "2026-06-10",
			},
			"u1",
		);
		const body = await res.json();
		expect(body.entry).toEqual(SAMPLE_ENTRY);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"cost.create",
			expect.objectContaining({ entryId: "ce-1" }),
		);
	});

	it("POST returns 400 when the body is invalid (missing provider)", async () => {
		const res = await route.POST(
			new Request("http://local/api/cost/entries", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "vps",
					amount: "10.00",
					effectiveDate: "2026-06-15",
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.createCostEntry).not.toHaveBeenCalled();
	});

	it("POST returns 400 when amount is negative", async () => {
		const res = await route.POST(
			new Request("http://local/api/cost/entries", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "vps",
					provider: "Linode",
					amount: "-1.00",
					effectiveDate: "2026-06-15",
				}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("POST returns 403 when the caller lacks cost:manage", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.POST(
			new Request("http://local/api/cost/entries", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					category: "vps",
					provider: "Linode",
					amount: "10.00",
					effectiveDate: "2026-06-15",
				}),
			}),
		);
		expect(res.status).toBe(403);
	});
});
