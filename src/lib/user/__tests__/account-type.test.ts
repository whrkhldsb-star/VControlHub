import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

const { prismaMock, teamServiceMock, assertAdminAccessMayBeRemovedMock } = vi.hoisted(() => ({
	prismaMock: {
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
		assertPlatformAdmin: vi.fn(),
	},
	assertAdminAccessMayBeRemovedMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/team/service", () => teamServiceMock);
vi.mock("../admin-invariant", () => ({
	assertAdminAccessMayBeRemoved: assertAdminAccessMayBeRemovedMock,
	withAdminInvariantLock: async (operation: () => Promise<unknown>) => operation(),
}));

const { setAccountType } = await import("../account-type");
const admin: SessionPayload = { userId: "root", username: "root", roles: ["admin"], mustChangePassword: false, currentTeamId: null };

describe("setAccountType", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		prismaMock.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as unknown[])));
		prismaMock.role.findUnique.mockResolvedValue({ id: "role_admin" });
		teamServiceMock.resolveCustomerMembershipTarget.mockImplementation(async (teamId: string, identityTemplateId?: string | null) => ({
			teamId,
			identityTemplateId: identityTemplateId ?? "identity:viewer",
		}));
	});

	it("is platform-only", async () => {
		teamServiceMock.assertPlatformAdmin.mockImplementationOnce(() => { throw new ForbiddenError("platform only"); });
		await expect(setAccountType("u1", { type: "admin" }, { ...admin, roles: [] })).rejects.toBeInstanceOf(ForbiddenError);
		expect(prismaMock.$transaction).not.toHaveBeenCalled();
	});

	it("makes an account a platform administrator and drops its customer", async () => {
		await setAccountType("u1", { type: "admin" }, admin);
		expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: "u1", roleId: "role_admin" } }));
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
