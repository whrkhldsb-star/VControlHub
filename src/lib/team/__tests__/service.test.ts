import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

const { prismaMock, auditUserActionMock, releaseLockMock, acquireAdvisoryLockMock } = vi.hoisted(() => {
	const releaseLockMock = vi.fn(async () => {});
	return {
		prismaMock: {
			team: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
			teamMember: {
				findMany: vi.fn(),
				findUnique: vi.fn(),
				create: vi.fn(),
				upsert: vi.fn(),
				update: vi.fn(),
				updateMany: vi.fn(),
				delete: vi.fn(),
				deleteMany: vi.fn(),
				count: vi.fn(),
			},
			user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
			server: { updateMany: vi.fn() },
			storageNode: { create: vi.fn() },
			roleTemplate: { findFirst: vi.fn(), createMany: vi.fn() },
			userServerAccess: { deleteMany: vi.fn() },
			userStorageAccess: { deleteMany: vi.fn() },
			$transaction: vi.fn(),
		},
		auditUserActionMock: vi.fn(),
		releaseLockMock,
		acquireAdvisoryLockMock: vi.fn(async () => releaseLockMock),
	};
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock, isUniqueViolation: (e: unknown) => (e as any)?.code === "P2002" }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));
// The real lock opens a pg pool; the service is what is under test here.
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: acquireAdvisoryLockMock }));

const {
	createTeam,
	switchCurrentTeam,
	transferTeamOwnership,
	addTeamMember,
	removeTeamMember,
	updateTeam,
	deleteTeam,
	listTeamsForSession,
	isDeletedTeamSlug,
} = await import("../service");

const adminSession: SessionPayload = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };
const viewerSession: SessionPayload = { userId: "u_viewer", username: "viewer", roles: ["viewer"], mustChangePassword: false, currentTeamId: null };

describe("team workspace service", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		acquireAdvisoryLockMock.mockResolvedValue(releaseLockMock);
		prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
		prismaMock.teamMember.findMany.mockResolvedValue([]);
		prismaMock.user.findMany.mockResolvedValue([]);
	});

	it("creates a team, owner membership, and switches current team for the creator", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce(null);
		prismaMock.team.create.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });
		prismaMock.teamMember.create.mockResolvedValueOnce({});
		prismaMock.user.update.mockResolvedValueOnce({});

		await expect(createTeam({ name: "Ops", slug: "ops", description: null }, adminSession)).resolves.toMatchObject({ id: "team_1", slug: "ops" });
		expect(prismaMock.teamMember.create).toHaveBeenCalledWith({ data: { teamId: "team_1", userId: "u_admin", role: "owner" } });
		expect(prismaMock.roleTemplate.createMany).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.arrayContaining([expect.objectContaining({ teamId: "team_1", kind: "POLICY_GROUP", roleKeys: [], permissions: expect.arrayContaining(["server:read"]) })]),
		}));
		expect(prismaMock.storageNode.create).toHaveBeenCalledWith({ data: expect.objectContaining({ teamId: "team_1", isDefault: true }) });
		expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_admin" }, data: { currentTeamId: "team_1" } });
		expect(auditUserActionMock).toHaveBeenCalledWith(
			"u_admin",
			"team.create",
			expect.objectContaining({ teamId: "team_1", slug: "ops" }),
			undefined,
			"team_1",
		);
	});

	it("prevents switching to a team the user does not belong to", async () => {
		prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);
		await expect(switchCurrentTeam("team_2", viewerSession)).rejects.toThrow("只能切换到你所属的团队工作区");
		expect(prismaMock.user.update).not.toHaveBeenCalled();
	});

	it("lets a platform administrator select a live workspace without membership", async () => {
		prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_2", slug: "dev", name: "Dev" });
		prismaMock.user.update.mockResolvedValueOnce({});
		await expect(switchCurrentTeam("team_2", adminSession)).resolves.toMatchObject({ id: "team_2" });
		expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_admin" }, data: { currentTeamId: "team_2" } });
	});

	it("rejects a team slug that uses the reserved deleted-workspace prefix", async () => {
		await expect(
			createTeam({ name: "Ghost", slug: "__deleted__ghost", description: null }, adminSession),
		).rejects.toThrow("该团队标识为系统保留");
		expect(prismaMock.team.create).not.toHaveBeenCalled();
	});

	it("tombstones a deleted workspace instead of dropping the row", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });

		prismaMock.team.findFirst.mockResolvedValueOnce(null);
		await expect(deleteTeam("team_1", adminSession)).resolves.toEqual({ deleted: true, currentTeamId: null });

		// Hard-deleting the row would SetNull every teamId on the workspace's data,
		// and `teamWhere()` reads null as "shared with every tenant".
		expect(prismaMock.team.delete).not.toHaveBeenCalled();
		expect(prismaMock.server.updateMany).not.toHaveBeenCalled();
		expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team_1" } });
		expect(prismaMock.user.findMany).toHaveBeenCalledWith({
			where: { currentTeamId: "team_1" },
			select: { id: true },
		});
		const update = prismaMock.team.update.mock.calls[0]?.[0];
		expect(update.where).toEqual({ id: "team_1" });
		expect(update.data.ownerId).toBeNull();
		expect(isDeletedTeamSlug(update.data.slug)).toBe(true);
		// The original slug is released for reuse.
		expect(update.data.slug).not.toBe("ops");
	});

	it("moves every affected login preference and the caller session to a surviving workspace", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });
		prismaMock.user.findMany.mockResolvedValueOnce([{ id: "u_admin" }, { id: "u_member" }]);
		prismaMock.teamMember.findMany
			.mockResolvedValueOnce([
				{ userId: "u_admin", teamId: "team_2", team: { slug: "dev" } },
				{ userId: "u_member", teamId: "team_old", team: { slug: "__deleted__old" } },
				{ userId: "u_member", teamId: "team_3", team: { slug: "qa" } },
			]);

		await expect(deleteTeam("team_1", { ...adminSession, currentTeamId: "team_1" })).resolves.toEqual({
			deleted: true,
			currentTeamId: "team_2",
		});
		expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
			where: { id: "u_admin", currentTeamId: "team_1" },
			data: { currentTeamId: "team_2" },
		});
		expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
			where: { id: "u_member", currentTeamId: "team_1" },
			data: { currentTeamId: "team_3" },
		});
		expect(prismaMock.teamMember.findMany).toHaveBeenCalledTimes(1);
		expect(prismaMock.teamMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { userId: { in: ["u_admin", "u_member"] }, teamId: { not: "team_1" } },
		}));
	});

	it("gives a platform administrator a live workspace fallback without membership", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });
		prismaMock.team.findFirst.mockResolvedValueOnce({ id: "team_2" });

		await expect(deleteTeam("team_1", { ...adminSession, currentTeamId: "team_1" })).resolves.toEqual({
			deleted: true,
			currentTeamId: "team_2",
		});
		expect(prismaMock.team.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ id: { not: "team_1" } }),
		}));
	});

	it("treats an already-tombstoned workspace as missing", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({
			id: "team_1",
			slug: "__deleted__abc-ops",
			name: "Ops",
		});

		await expect(deleteTeam("team_1", adminSession)).rejects.toThrow("团队工作区不存在");
		expect(prismaMock.team.update).not.toHaveBeenCalled();
	});

	it("hides tombstoned workspaces from the team list", async () => {
		prismaMock.team.findMany.mockResolvedValueOnce([]);
		prismaMock.user.findUnique.mockResolvedValueOnce({ currentTeamId: null });

		await listTeamsForSession(adminSession);

		const where = prismaMock.team.findMany.mock.calls[0]?.[0].where;
		expect(where).toMatchObject({ NOT: { slug: { startsWith: "\\_\\_deleted\\_\\_" } } });
	});

	it("reports no current workspace when the stored pointer is not in the list", async () => {
		// The switcher renders `teams`; a pointer outside it is stale (tombstoned
		// workspace, or a membership that is gone) and must not be echoed back as
		// the active workspace.
		prismaMock.team.findMany.mockResolvedValueOnce([{ id: "team_2" }]);
		prismaMock.user.findUnique.mockResolvedValueOnce({ currentTeamId: "team_1" });

		await expect(listTeamsForSession(viewerSession)).resolves.toMatchObject({ currentTeamId: null });
	});

	it("keeps the current workspace when it is one of the listed teams", async () => {
		prismaMock.team.findMany.mockResolvedValueOnce([{ id: "team_1" }, { id: "team_2" }]);
		await expect(listTeamsForSession({ ...viewerSession, currentTeamId: "team_1" })).resolves.toMatchObject({ currentTeamId: "team_1" });
	});

	it("scopes a non-admin's team list to their own memberships", async () => {
		prismaMock.team.findMany.mockResolvedValueOnce([]);
		prismaMock.user.findUnique.mockResolvedValueOnce({ currentTeamId: null });

		await listTeamsForSession(viewerSession);

		expect(prismaMock.team.findMany.mock.calls[0]?.[0].where).toMatchObject({
			members: { some: { userId: "u_viewer" } },
		});
	});

	it("retries with another slug when a concurrent create wins the race", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
		prismaMock.$transaction
			.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
			.mockImplementationOnce(async (fn: any) => fn(prismaMock));
		prismaMock.team.create.mockResolvedValueOnce({ id: "team_2", slug: "ops-2", name: "Ops" });

		await expect(createTeam({ name: "Ops", slug: "ops", description: null }, adminSession)).resolves.toMatchObject({
			slug: "ops-2",
		});
	});

	it("does not retry a create that failed for a reason other than the slug", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce(null);
		prismaMock.$transaction.mockRejectedValueOnce(new Error("connection lost"));

		await expect(createTeam({ name: "Ops", slug: "ops", description: null }, adminSession)).rejects.toThrow(
			"connection lost",
		);
		expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
	});

	it("refuses team creation without team:create", async () => {
		await expect(createTeam({ name: "Ops", slug: "ops", description: null }, viewerSession)).rejects.toThrow(
			ForbiddenError,
		);
		expect(prismaMock.team.findUnique).not.toHaveBeenCalled();
	});

	it("allows a team admin to add or update a member by username", async () => {
		prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "admin" });
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops" });
		prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u_member", username: "alice" });
		prismaMock.teamMember.upsert.mockResolvedValueOnce({ role: "member", user: { id: "u_member", username: "alice", displayName: null, status: "ACTIVE" } });

		await expect(addTeamMember("team_1", { username: "alice", role: "member" }, { ...viewerSession, roles: ["viewer"] as any })).resolves.toMatchObject({ role: "member" });
		expect(prismaMock.teamMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
			where: { teamId_userId: { teamId: "team_1", userId: "u_member" } },
			update: { role: "member" },
		}));
	});

	it("promotes an administrator without retaining member ceilings or resource overrides", async () => {
		prismaMock.teamMember.findUnique
			.mockResolvedValueOnce({ role: "admin" })
			.mockResolvedValueOnce({ role: "member" });
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
		prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u_member", username: "alice" });
		prismaMock.teamMember.upsert.mockResolvedValueOnce({ role: "admin", accessRole: "inherit", permissionTemplateId: null, user: { id: "u_member", username: "alice" } });

		await addTeamMember("team_1", {
			username: "alice", role: "admin", accessRole: "viewer", permissionTemplateId: "ignored-template",
		}, { ...viewerSession, currentTeamId: "team_1" });

		expect(prismaMock.teamMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
			update: { role: "admin", accessRole: "inherit", permissionTemplateId: null },
			create: expect.objectContaining({ role: "admin", accessRole: "inherit", permissionTemplateId: null }),
		}));
		expect(prismaMock.roleTemplate.findFirst).not.toHaveBeenCalled();
		expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_member", server: { teamId: "team_1" } } });
		expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_member", storageNode: { teamId: "team_1" } } });
	});

	it("rejects applying an account template as a live workspace permission group", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_admin" });
		prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u_member", username: "alice" });
		prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);
		prismaMock.roleTemplate.findFirst.mockResolvedValueOnce(null);

		await expect(addTeamMember("team_1", {
			username: "alice", role: "member", permissionTemplateId: "template_1",
		}, adminSession)).rejects.toThrow();
		expect(prismaMock.roleTemplate.findFirst).toHaveBeenCalledWith({
			where: { id: "template_1", teamId: "team_1", kind: "POLICY_GROUP", isBuiltin: false },
			select: { id: true },
		});
		expect(prismaMock.teamMember.upsert).not.toHaveBeenCalled();
	});

	describe("transferTeamOwnership", () => {
		const ownerSession = { ...viewerSession, userId: "u_owner", currentTeamId: "team_1" };

		it("moves ownership to an active member in one transaction", async () => {
			prismaMock.team.findUnique.mockResolvedValue({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ user: { id: "u_member", status: "ACTIVE", username: "alice" } });
			prismaMock.team.update.mockResolvedValueOnce({});
			await expect(transferTeamOwnership("team_1", { userId: "u_member" }, ownerSession)).resolves.toEqual({ teamId: "team_1", ownerId: "u_member", username: "alice" });
			expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
			expect(prismaMock.teamMember.updateMany).toHaveBeenCalledWith({ where: { teamId: "team_1", role: "owner" }, data: { role: "admin", accessRole: "inherit", permissionTemplateId: null } });
			expect(prismaMock.teamMember.update).toHaveBeenCalledWith({ where: { teamId_userId: { teamId: "team_1", userId: "u_member" } }, data: { role: "owner", accessRole: "inherit", permissionTemplateId: null } });
			expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: "team_1" }, data: { ownerId: "u_member" } });
			expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalled();
			expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalled();
			expect(releaseLockMock).toHaveBeenCalled();
		});

		it("rejects a team administrator who is not the owner before taking the lock", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			await expect(transferTeamOwnership("team_1", { userId: "u_member" }, viewerSession)).rejects.toThrow(ForbiddenError);
			expect(acquireAdvisoryLockMock).not.toHaveBeenCalled();
		});

		it("rejects a disabled or non-member target", async () => {
			prismaMock.team.findUnique.mockResolvedValue({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ user: { id: "u_member", status: "DISABLED", username: "alice" } });
			await expect(transferTeamOwnership("team_1", { userId: "u_member" }, ownerSession)).rejects.toThrow(NotFoundError);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
			expect(releaseLockMock).toHaveBeenCalled();
		});
	});

	describe("removeTeamMember", () => {
		/** Distinct client so a statement run outside the transaction is visible. */
		function stubTransaction(fallbacks: Array<{ userId: string; teamId: string; team: { slug: string } }> = []) {
			const tx = {
				teamMember: {
					findMany: vi.fn(async (_args: unknown) => fallbacks),
					delete: vi.fn(async (_args: unknown) => ({})),
				},
				user: { updateMany: vi.fn(async (_args: any) => ({ count: 1 })) },
			};
			prismaMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
			return tx;
		}

		it("moves the removed user's workspace pointer to another live membership", async () => {
			// Membership removal revokes live access; the user pointer moves in the
			// same transaction so a later login does not prefer the removed workspace.
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "member" });
			const tx = stubTransaction([
				{ userId: "u_member", teamId: "team_deleted", team: { slug: "__deleted__old" } },
				{ userId: "u_member", teamId: "team_2", team: { slug: "dev" } },
			]);

			await expect(removeTeamMember("team_1", "u_member", adminSession)).resolves.toEqual({ removed: true });

			expect(tx.teamMember.delete).toHaveBeenCalledWith({
				where: { teamId_userId: { teamId: "team_1", userId: "u_member" } },
			});
			expect(tx.user.updateMany).toHaveBeenCalledWith({
				where: { id: "u_member", currentTeamId: "team_1" },
				data: { currentTeamId: "team_2" },
			});
			expect(prismaMock.teamMember.delete).not.toHaveBeenCalled();
			expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
			expect(releaseLockMock).toHaveBeenCalled();
		});

		it("never clears the pointer of a user who was not switched into this team", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "member" });
			const tx = stubTransaction();

			await removeTeamMember("team_1", "u_member", adminSession);

			// The `currentTeamId: teamId` predicate is what keeps this from resetting
			// an unrelated workspace the user happens to be working in.
			expect(tx.user.updateMany.mock.calls[0]?.[0].where).toEqual({
				id: "u_member",
				currentTeamId: "team_1",
			});
		});

		it("refuses to remove the workspace owner", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_member" });

			await expect(removeTeamMember("team_1", "u_member", adminSession)).rejects.toThrow(ForbiddenError);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
			expect(releaseLockMock).toHaveBeenCalled();
		});

		it("refuses to remove the last owner", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: null });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "owner" });
			prismaMock.teamMember.count.mockResolvedValueOnce(1);

			await expect(removeTeamMember("team_1", "u_owner", adminSession)).rejects.toThrow(ForbiddenError);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
		});

		it("allows removing a co-owner while another owner remains", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: null });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "owner" });
			prismaMock.teamMember.count.mockResolvedValueOnce(2);
			const tx = stubTransaction();

			await expect(removeTeamMember("team_1", "u_owner2", adminSession)).resolves.toEqual({ removed: true });
			expect(tx.teamMember.delete).toHaveBeenCalled();
		});

		it("treats a non-member as missing", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);

			await expect(removeTeamMember("team_1", "u_stranger", adminSession)).rejects.toThrow(NotFoundError);
			expect(prismaMock.$transaction).not.toHaveBeenCalled();
		});

		it("treats a tombstoned workspace as missing", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "__deleted__abc-ops", ownerId: null });

			await expect(removeTeamMember("team_1", "u_member", adminSession)).rejects.toThrow(NotFoundError);
			expect(prismaMock.teamMember.findUnique).not.toHaveBeenCalled();
		});

		it("rejects a plain member before taking the membership lock", async () => {
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "member" });

			await expect(removeTeamMember("team_1", "u_other", viewerSession)).rejects.toThrow(ForbiddenError);
			// Holding a workspace-wide lock for a caller who cannot pass the guard
			// lets any authenticated user stall every membership change on that team.
			expect(acquireAdvisoryLockMock).not.toHaveBeenCalled();
		});

		it("lets a team admin without global team:manage remove a member", async () => {
			prismaMock.teamMember.findUnique
				.mockResolvedValueOnce({ role: "admin" })
				.mockResolvedValueOnce({ role: "member" });
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			stubTransaction();

			await expect(removeTeamMember("team_1", "u_member", viewerSession)).resolves.toEqual({ removed: true });
			expect(acquireAdvisoryLockMock).toHaveBeenCalledWith("team-membership", "team_1");
		});

		it("releases the lock when the removal fails", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", ownerId: "u_owner" });
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role: "member" });
			prismaMock.$transaction.mockRejectedValueOnce(new Error("deadlock detected"));

			await expect(removeTeamMember("team_1", "u_member", adminSession)).rejects.toThrow("deadlock detected");
			// A leaked pg advisory lock blocks every later membership change on this team.
			expect(releaseLockMock).toHaveBeenCalled();
		});
	});

	describe("assertCanManageTeam (via updateTeam)", () => {
		it("skips the membership lookup for a global team:manage holder", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops" });
			prismaMock.team.update.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops", description: null });

			await expect(updateTeam("team_1", { name: "Ops" }, adminSession)).resolves.toMatchObject({ id: "team_1" });
			expect(prismaMock.teamMember.findUnique).not.toHaveBeenCalled();
		});

		it.each([
			["owner", true],
			["admin", true],
			["member", false],
		])("resolves a %s membership to canManage=%s", async (role, allowed) => {
			prismaMock.teamMember.findUnique.mockResolvedValueOnce({ role });
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops" });
			prismaMock.team.update.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops", description: null });

			const call = updateTeam("team_1", { name: "Ops" }, viewerSession);
			if (allowed) await expect(call).resolves.toMatchObject({ id: "team_1" });
			else await expect(call).rejects.toThrow(ForbiddenError);
		});

		it("rejects a caller with no membership at all", async () => {
			prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);

			await expect(updateTeam("team_1", { name: "Ops" }, viewerSession)).rejects.toThrow(ForbiddenError);
			expect(prismaMock.team.update).not.toHaveBeenCalled();
		});

		it("normalises an emptied description to null rather than an empty string", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops" });
			prismaMock.team.update.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops", description: null });

			await updateTeam("team_1", { description: "   " }, adminSession);

			expect(prismaMock.team.update.mock.calls[0]?.[0].data).toEqual({ description: null });
		});
	});
});
