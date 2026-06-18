import { afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";

const { requireSessionMock, sessionHasPermissionMock } = vi.hoisted(() => ({
	requireSessionMock: vi.fn(),
	sessionHasPermissionMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
	requireSession: requireSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: sessionHasPermissionMock,
}));

// Import after mocks are wired so the page-guard module sees the mocked graph.
import { requirePagePermission } from "../page-guard";

describe("requirePagePermission", () => {
	afterEach(() => {
		requireSessionMock.mockReset();
		sessionHasPermissionMock.mockReset();
	});

	it("returns the session when the permission is granted", async () => {
		const session = { userId: "u1", roles: ["admin"] };
		requireSessionMock.mockResolvedValue(session);
		sessionHasPermissionMock.mockReturnValue(true);

		await expect(requirePagePermission("cost:read")).resolves.toEqual(session);

		expect(requireSessionMock).toHaveBeenCalledWith(undefined);
		expect(sessionHasPermissionMock).toHaveBeenCalledWith(session, "cost:read");
	});

	it("forwards the redirectTo option to requireSession()", async () => {
		const session = { userId: "u2", roles: ["viewer"] };
		requireSessionMock.mockResolvedValue(session);
		sessionHasPermissionMock.mockReturnValue(true);

		await expect(
			requirePagePermission("audit:read", { redirectTo: "/audit" }),
		).resolves.toEqual(session);

		expect(requireSessionMock).toHaveBeenCalledWith("/audit");
	});

	it("throws ForbiddenError when the session lacks the permission", async () => {
		const session = { userId: "u3", roles: ["viewer"] };
		requireSessionMock.mockResolvedValue(session);
		sessionHasPermissionMock.mockReturnValue(false);

		await expect(requirePagePermission("cost:manage")).rejects.toBeInstanceOf(
			ForbiddenError,
		);

		const call = sessionHasPermissionMock.mock.calls[0];
		expect(call).toEqual([session, "cost:manage"]);
	});

	it("attaches the offending permission to the ForbiddenError details", async () => {
		const session = { userId: "u4", roles: [] };
		requireSessionMock.mockResolvedValue(session);
		sessionHasPermissionMock.mockReturnValue(false);

		try {
			await requirePagePermission("ai:ops:manage");
			throw new Error("expected requirePagePermission to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ForbiddenError);
			if (!(error instanceof ForbiddenError)) return;
			expect(error.status).toBe(403);
			expect(error.code).toBe("FORBIDDEN");
			expect(error.message).toContain("ai:ops:manage");
			expect(error.details).toEqual({ permission: "ai:ops:manage" });
		}
	});

	it("propagates the redirect-or-throw behaviour of requireSession()", async () => {
		// Simulate the typical requireSession behaviour when the user is
		// unauthenticated: it throws / redirects. The page guard must not
		// swallow that — the upstream login flow stays in charge.
		requireSessionMock.mockRejectedValue(new Error("redirect to /login"));

		await expect(requirePagePermission("storage:read")).rejects.toThrow(
			"redirect to /login",
		);
		expect(sessionHasPermissionMock).not.toHaveBeenCalled();
	});
});
