import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
	prisma: { user: { findUnique: findUniqueMock } },
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

	it("builds a current owner session and drops unknown role keys", async () => {
		findUniqueMock.mockResolvedValue({
			id: "user-1",
			username: "alice",
			status: "ACTIVE",
			mustChangePassword: false,
			currentTeamId: "team-1",
			roles: [{ role: { key: "viewer" } }, { role: { key: "removed-role" } }],
		});

		await expect(loadApiTokenOwnerSession("user-1")).resolves.toMatchObject({
			userId: "user-1",
			roles: ["viewer"],
			currentTeamId: "team-1",
		});
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
			currentTeamId: null,
			roles: [],
		});

		await expect(loadApiTokenOwnerSession("user-1")).resolves.toBeNull();
	});
});
