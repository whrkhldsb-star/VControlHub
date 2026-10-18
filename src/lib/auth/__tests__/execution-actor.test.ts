import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
	loadApiTokenOwnerSession: vi.fn(),
	sessionHasPermission: vi.fn(),
	serverCount: vi.fn(),
	assertStorageAccess: vi.fn(),
}));

vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/auth/team-scope", () => ({ serverTeamWhere: (session: { currentTeamId: string | null }) => ({ teamId: session.currentTeamId }) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { count: mocks.serverCount } } }));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: mocks.assertStorageAccess }));

const { executionRefusal } = await import("../execution-actor");

const creator = { userId: "u-1", username: "creator", roles: ["operator"], mustChangePassword: false, currentTeamId: "team-1" } satisfies SessionPayload;
const job = { createdBy: "u-1", teamId: "team-1", permission: "storage:write" as const, serverIds: ["s-1", "s-2"] };

describe("executionRefusal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadApiTokenOwnerSession.mockResolvedValue(creator);
		mocks.sessionHasPermission.mockReturnValue(true);
		mocks.serverCount.mockResolvedValue(2);
		mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
	});

	it("lets work run while its creator may still do it", async () => {
		await expect(executionRefusal(job)).resolves.toBeNull();
		expect(mocks.loadApiTokenOwnerSession).toHaveBeenCalledWith("u-1", "team-1");
		expect(mocks.serverCount).toHaveBeenCalledWith({ where: { id: { in: ["s-1", "s-2"] }, enabled: true, teamId: "team-1" } });
	});

	it("refuses once the creator is disabled, removed from the customer or must change the password", async () => {
		mocks.loadApiTokenOwnerSession.mockResolvedValue(null);
		await expect(executionRefusal(job)).resolves.toBe("backend.execution.ownerInactive");
		await expect(executionRefusal({ ...job, createdBy: null })).resolves.toBe("backend.execution.ownerInactive");
	});

	it("refuses when the permission was revoked", async () => {
		mocks.sessionHasPermission.mockReturnValue(false);
		await expect(executionRefusal(job)).resolves.toBe("backend.execution.permissionRevoked");
	});

	it("refuses when a server was disabled or left the creator's reach", async () => {
		mocks.serverCount.mockResolvedValue(1);
		await expect(executionRefusal(job)).resolves.toBe("backend.execution.serverUnavailable");
	});

	it("counts a server named twice (source = target) once", async () => {
		mocks.serverCount.mockResolvedValue(1);
		await expect(executionRefusal({ ...job, serverIds: ["s-1", "s-1"] })).resolves.toBeNull();
	});

	it("refuses a write the creator's path grants no longer allow", async () => {
		mocks.assertStorageAccess.mockResolvedValue({ allowed: false, reason: "path" });
		const writesTo = { storageNodeId: "node-1", relativePath: "downloads" };
		await expect(executionRefusal({ ...job, writesTo })).resolves.toBe("backend.execution.storageRevoked");
		expect(mocks.assertStorageAccess).toHaveBeenCalledWith({ session: creator, ...writesTo, operation: "write" });
	});

	it("judges a manual run by the person running it, and a pre-loaded inactive creator as inactive", async () => {
		const runner = { ...creator, userId: "u-2", username: "runner", roles: ["admin"] } satisfies SessionPayload;
		await expect(executionRefusal({ ...job, actor: runner })).resolves.toBeNull();
		expect(mocks.loadApiTokenOwnerSession).not.toHaveBeenCalled();
		await expect(executionRefusal({ ...job, actor: null })).resolves.toBe("backend.execution.ownerInactive");
	});
});
