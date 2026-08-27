import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireApiPermission: vi.fn(),
	listItsmEvents: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/itsm/service", () => ({ listItsmEvents: mocks.listItsmEvents }));

const route = await import("../route");

describe("GET /api/itsm/events limit validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({
			session: { userId: "user-1", roles: ["admin"], currentTeamId: "team-1" },
		});
		mocks.listItsmEvents.mockResolvedValue([]);
	});

	it("defaults to 50 events when limit is omitted", async () => {
		const response = await route.GET(new Request("http://local/api/itsm/events"));
		expect(response.status).toBe(200);
		expect(mocks.listItsmEvents).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 50, connectionId: undefined, ticketId: undefined }),
		);
	});

	it("passes a valid limit and the filters through", async () => {
		const response = await route.GET(
			new Request("http://local/api/itsm/events?limit=10&connectionId=c1&ticketId=t1"),
		);
		expect(response.status).toBe(200);
		expect(mocks.listItsmEvents).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 10, connectionId: "c1", ticketId: "t1" }),
		);
	});

	it.each(["5.7", "-5", "0", "abc", "9999"])(
		"rejects limit=%s with 400 instead of reaching Prisma take",
		async (limit) => {
			const response = await route.GET(
				new Request(`http://local/api/itsm/events?limit=${limit}`),
			);
			expect(response.status).toBe(400);
			expect(mocks.listItsmEvents).not.toHaveBeenCalled();
		},
	);
});
