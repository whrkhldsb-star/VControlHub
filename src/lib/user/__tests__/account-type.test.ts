import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken, type SessionPayload } from "@/lib/auth/session";
import { AuthError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

const { prismaMock, teamServiceMock, assertAdminAccessMayBeRemovedMock, assertPlatformAdminMock } = vi.hoisted(() => ({
	prismaMock: {
		user: { findUnique: vi.fn() },
		$queryRaw: vi.fn(),
		$executeRaw: vi.fn(),
		role: { findUnique: vi.fn() },
		teamMember: { deleteMany: vi.fn() },
		userServerAccess: { deleteMany: vi.fn() },
		userStorageAccess: { deleteMany: vi.fn() },
		userRole: { upsert: vi.fn(), deleteMany: vi.fn() },
		$transaction: vi.fn(),
	},
	teamServiceMock: {
		applyCustomerMembership: vi.fn(),
		resolveCustomerMembershipTarget: vi.fn(),
	},
	assertPlatformAdminMock: vi.fn(),
	assertAdminAccessMayBeRemovedMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/team/service", () => teamServiceMock);
vi.mock("@/lib/auth/platform-admin-guard", () => ({ assertPlatformAdmin: assertPlatformAdminMock }));
vi.mock("../admin-invariant", async (importOriginal) => ({
	...await importOriginal<typeof import("../admin-invariant")>(),
	assertAdminAccessMayBeRemoved: assertAdminAccessMayBeRemovedMock,
}));

const { setAccountType } = await import("../account-type");
const login: SessionPayload = { userId: "root", username: "root", roles: ["admin"], mustChangePassword: false, currentTeamId: null };

const adminRow = {
	id: login.userId, username: login.username, roles: [{ role: { key: "admin" } }],
	status: "ACTIVE", passwordHash: "login-hash", sessionEpoch: 4, mustChangePassword: false,
};

describe("setAccountType", () => {
	let admin: SessionPayload;
	beforeEach(async () => {
		vi.resetAllMocks();
		prismaMock.user.findUnique.mockResolvedValue(adminRow);
		prismaMock.$queryRaw.mockResolvedValue([adminRow]);
		admin = await verifySessionToken(await createSessionToken(login));
		prismaMock.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as unknown[])));
		prismaMock.role.findUnique.mockResolvedValue({ id: "role_admin" });
		teamServiceMock.resolveCustomerMembershipTarget.mockImplementation(async (teamId: string, identityTemplateId?: string | null) => ({
			teamId,
			identityTemplateId: identityTemplateId ?? "identity:viewer",
		}));
	});

	it("is platform-only", async () => {
		assertPlatformAdminMock.mockImplementationOnce(() => { throw new ForbiddenError("platform only"); });
		await expect(setAccountType("u1", { type: "admin" }, { ...admin, roles: [] })).rejects.toBeInstanceOf(ForbiddenError);
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
	});

	it("makes an account a platform administrator and drops its customer", async () => {
		await setAccountType("u1", { type: "admin" }, admin);
		const [actorLock, targetLock] = prismaMock.$queryRaw.mock.calls;
		expect(actorLock![0].join("?")).toMatch(/u.id = \? AND r.key = 'admin'\s+FOR UPDATE OF u FOR SHARE OF ur, r/);
		expect(actorLock![1]).toBe(admin.userId);
		expect(targetLock![0].join("?")).toContain('FROM "User" WHERE id = ? FOR UPDATE');
		expect(targetLock![1]).toBe("u1");
		expect(prismaMock.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(prismaMock.role.findUnique.mock.invocationCallOrder[0]!);
		expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: "u1", roleId: "role_admin" } }));
	});

	it.each([
		["role revoked", [], ForbiddenError],
		["disabled", [{ ...adminRow, status: "DISABLED" }], AuthError],
		["pending reset", [{ ...adminRow, status: "PENDING_PASSWORD_RESET" }], AuthError],
		["password change required", [{ ...adminRow, mustChangePassword: true }], AuthError],
		["signed out everywhere", [{ ...adminRow, sessionEpoch: 5 }], AuthError],
		["password reset", [{ ...adminRow, passwordHash: "replacement-hash" }], AuthError],
	] as const)("rejects the original session after %s and writes no grants", async (_name, rows, errorType) => {
		prismaMock.$queryRaw.mockResolvedValueOnce(rows);
		await expect(setAccountType("u1", { type: "admin" }, admin)).rejects.toBeInstanceOf(errorType);
		expect(prismaMock.userRole.upsert).not.toHaveBeenCalled();
		expect(prismaMock.teamMember.deleteMany).not.toHaveBeenCalled();
	});

	it("removes the roles and writes the membership in one transaction", async () => {
		await setAccountType("u1", { type: "customer", teamId: "team_a", identityTemplateId: "identity:operator" }, admin);
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
		expect(prismaMock.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(teamServiceMock.applyCustomerMembership).toHaveBeenCalledWith(prismaMock, { userId: "u1", teamId: "team_a", identityTemplateId: "identity:operator" });
	});

	it("checks the customer and template before touching the roles", async () => {
		teamServiceMock.resolveCustomerMembershipTarget.mockRejectedValueOnce(new NotFoundError("no template"));
		await expect(setAccountType("u1", { type: "customer", teamId: "team_a", identityTemplateId: "missing" }, admin)).rejects.toBeInstanceOf(NotFoundError);
		expect(prismaMock.userRole.deleteMany).not.toHaveBeenCalled();
		expect(teamServiceMock.applyCustomerMembership).not.toHaveBeenCalled();
	});

	it("demotes an administrator only if another administrator remains", async () => {
		assertAdminAccessMayBeRemovedMock.mockRejectedValueOnce(new ConflictError("last admin"));
		await expect(setAccountType("u2", { type: "customer", teamId: "team_a" }, admin)).rejects.toBeInstanceOf(ConflictError);
		expect(prismaMock.userRole.deleteMany).not.toHaveBeenCalled();
		expect(teamServiceMock.applyCustomerMembership).not.toHaveBeenCalled();
	});
});
