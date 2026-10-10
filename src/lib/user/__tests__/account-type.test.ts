import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { ConflictError } from "@/lib/errors";

const { prismaMock, setCustomerMembershipMock, assertAdminAccessMayBeRemovedMock } = vi.hoisted(() => ({
	prismaMock: {
		role: { findUnique: vi.fn() },
		teamMember: { deleteMany: vi.fn() },
		userServerAccess: { deleteMany: vi.fn() },
		userStorageAccess: { deleteMany: vi.fn() },
		userRole: { upsert: vi.fn(), deleteMany: vi.fn() },
		$transaction: vi.fn(),
	},
	setCustomerMembershipMock: vi.fn(),
	assertAdminAccessMayBeRemovedMock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/team/service", () => ({ setCustomerMembership: setCustomerMembershipMock }));
vi.mock("../admin-invariant", () => ({
	assertAdminAccessMayBeRemoved: assertAdminAccessMayBeRemovedMock,
	withAdminInvariantLock: async (operation: () => Promise<unknown>) => operation(),
}));

const { setAccountType } = await import("../account-type");
const admin: SessionPayload = { userId: "root", username: "root", roles: ["admin"], mustChangePassword: false, currentTeamId: null };

describe("setAccountType", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
		prismaMock.role.findUnique.mockResolvedValue({ id: "role_admin" });
	});

	it("makes an account a platform administrator and drops its customer", async () => {
		await setAccountType("u1", { type: "admin" }, admin);
		expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: "u1", roleId: "role_admin" } }));
	});

	it("demotes an administrator to a customer account only if another administrator remains", async () => {
		await setAccountType("u1", { type: "customer", teamId: "team_a", identityTemplateId: "identity:viewer" }, admin);
		expect(prismaMock.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
		expect(setCustomerMembershipMock).toHaveBeenCalledWith({ userId: "u1", teamId: "team_a", identityTemplateId: "identity:viewer" }, admin);

		assertAdminAccessMayBeRemovedMock.mockRejectedValueOnce(new ConflictError("last admin"));
		await expect(setAccountType("u2", { type: "customer", teamId: "team_a" }, admin)).rejects.toBeInstanceOf(ConflictError);
		expect(setCustomerMembershipMock).toHaveBeenCalledTimes(1);
	});
});
