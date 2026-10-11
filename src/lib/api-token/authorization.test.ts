import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const { findUniqueMock, teamFindUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn(), teamFindUniqueMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
	prisma: { user: { findUnique: findUniqueMock }, team: { findUnique: teamFindUniqueMock } },
}));

import {
	apiTokenScopeAllowedForSession,
	loadApiTokenOwnerSession,
	tokenAllowsPermission,
} from "./authorization";

const viewerSession: SessionPayload = {
	userId: "user-1",
	username: "viewer",
	roles: ["viewer"],
	mustChangePassword: false,
	currentTeamId: null,
};

describe("API token authorization", () => {
	beforeEach(() => vi.clearAllMocks());

	it("intersects wildcard read scopes with read permissions only", () => {
		expect(tokenAllowsPermission(["read"], "server:read")).toBe(true);
		expect(tokenAllowsPermission(["read"], "server:write")).toBe(false);
		expect(tokenAllowsPermission(["storage:write"], "storage:write")).toBe(true);
	});

	it("only allows issuance scopes held by the current account", () => {
		expect(apiTokenScopeAllowedForSession("server:read", viewerSession)).toBe(true);
		expect(apiTokenScopeAllowedForSession("storage:write", viewerSession)).toBe(false);
		expect(apiTokenScopeAllowedForSession("status:read", viewerSession)).toBe(true);
		expect(apiTokenScopeAllowedForSession("unknown:scope", viewerSession)).toBe(false);
	});

	const customerOwner = (teamMembership: unknown) => ({
		id: "user-1",
		username: "alice",
		status: "ACTIVE",
		mustChangePassword: false,
		currentTeamId: "team-1",
		teamMembership,
		roles: [{ role: { key: "removed-role" } }],
	});
	const liveMembership = { teamId: "team-1", team: { deletedAt: null }, identityTemplate: { permissions: ["server:read", "server:write"] } };

	it("builds a customer owner's session from its identity template", async () => {
		findUniqueMock.mockResolvedValue(customerOwner(liveMembership));

		await expect(loadApiTokenOwnerSession("user-1")).resolves.toMatchObject({
			userId: "user-1",
			roles: [],
			currentTeamId: "team-1",
			permissions: expect.arrayContaining(["server:write", "team:read"]),
		});
	});

	it("drops the customer once the owner's membership is gone", async () => {
		// A token outlives the removal that revoked its owner's access, and
		// `currentTeamId` is what `teamWhere()` scopes every query by.
		findUniqueMock.mockResolvedValue(customerOwner(null));

		await expect(loadApiTokenOwnerSession("user-1")).resolves.toMatchObject({
			currentTeamId: null,
			permissions: ["user:read"],
		});
	});

	it("keeps a bearer credential bound to its issued customer and rejects any other", async () => {
		findUniqueMock.mockResolvedValue(customerOwner(liveMembership));
		await expect(loadApiTokenOwnerSession("user-1", "team-1")).resolves.toMatchObject({ currentTeamId: "team-1" });
		// The owner moved to another customer: the old credential stops working.
		await expect(loadApiTokenOwnerSession("user-1", "team-2")).resolves.toBeNull();
	});

	it("binds an administrator token to its customer while that customer is live", async () => {
		findUniqueMock.mockResolvedValue({ ...customerOwner(null), roles: [{ role: { key: "admin" } }] });
		teamFindUniqueMock.mockResolvedValueOnce({ deletedAt: null });
		await expect(loadApiTokenOwnerSession("user-1", "team-9")).resolves.toMatchObject({ currentTeamId: "team-9", roles: ["admin"] });
		teamFindUniqueMock.mockResolvedValueOnce({ deletedAt: new Date() });
		await expect(loadApiTokenOwnerSession("user-1", "team-9")).resolves.toBeNull();
	});

	it.each([
		["DISABLED", false],
		["ACTIVE", true],
	])("rejects unavailable token owners", async (status, mustChangePassword) => {
		findUniqueMock.mockResolvedValue({
			id: "user-1",
			username: "alice",
			status,
			mustChangePassword,
			teamMembership: null,
			roles: [],
		});

		await expect(loadApiTokenOwnerSession("user-1")).resolves.toBeNull();
	});
});
