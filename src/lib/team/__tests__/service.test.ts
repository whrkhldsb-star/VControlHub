import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

const { prismaMock, auditUserActionMock, writeAuditLog } = vi.hoisted(() => ({
	prismaMock: {
		team: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateManyAndReturn: vi.fn() },
		teamMember: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
		user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
		identityTemplate: { findUnique: vi.fn() },
		storageNode: { create: vi.fn() },
		userServerAccess: { deleteMany: vi.fn() },
		userStorageAccess: { deleteMany: vi.fn() },
		$transaction: vi.fn(),
		$queryRaw: vi.fn(),
	},
	auditUserActionMock: vi.fn(),
	writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/session", async original => ({ ...await original<typeof import("@/lib/auth/session")>(), assertSessionCredentialBinding: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock, isUniqueViolation: (e: unknown) => (e as { code?: string })?.code === "P2002" }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock, writeAuditLog }));

const {
	createTeam,
	deleteTeam,
	listLiveCustomerOptions,
	listTeamsForSession,
	removeTeamMember,
	restoreTeam,
	setCustomerMembership,
	switchCurrentTeam,
	updateTeam,
	updateTeamMemberTemplate,
} = await import("../service");

const admin: SessionPayload = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };
const customerAccount: SessionPayload = { userId: "u_c", username: "carol", roles: [], permissions: ["team:read"], mustChangePassword: false, currentTeamId: "team_a" };
const live = (id = "team_a") => ({ id, slug: id, name: id.toUpperCase(), deletedAt: null });

describe("customer service", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		prismaMock.$queryRaw.mockImplementation(async (sql: TemplateStringsArray, id: string) => {
			if (sql.join("").includes('JOIN "UserRole"')) return [{ status: "ACTIVE", mustChangePassword: false }];
			if (sql.join("").includes("identity_templates")) return id === "missing" ? [] : [{ id }];
			return [live(id)];
		});
		prismaMock.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as unknown[])));
		prismaMock.team.updateManyAndReturn.mockResolvedValue([live()]);
		prismaMock.team.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => live(where.id));
	});

	describe("platform-only operations", () => {
		it.each([
			["createTeam", () => createTeam({ name: "Acme" }, customerAccount)],
			["updateTeam", () => updateTeam("team_a", { name: "X" }, customerAccount)],
			["deleteTeam", () => deleteTeam("team_a", customerAccount)],
			["restoreTeam", () => restoreTeam("team_a", customerAccount)],
			["switchCurrentTeam", () => switchCurrentTeam("team_b", customerAccount)],
			["setCustomerMembership", () => setCustomerMembership({ teamId: "team_a", userId: "u_x" }, customerAccount)],
			["updateTeamMemberTemplate", () => updateTeamMemberTemplate("team_a", "u_x", "tpl", customerAccount)],
			["removeTeamMember", () => removeTeamMember("team_a", "u_x", customerAccount)],
		])("refuses %s for a customer account", async (_name, run) => {
			await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
		});
	});

	it("continues live customer options by sort keys when the boundary customer is archived", async () => {
		const createdAt = new Date("2026-01-01T00:00:00Z");
		const first = Array.from({ length: 500 }, (_, index) => ({ ...live(String(index).padStart(3, "0")), createdAt }));
		prismaMock.team.findMany.mockResolvedValueOnce(first).mockResolvedValueOnce([{ ...live("500"), createdAt }]);
		const options = await listLiveCustomerOptions();
		expect(prismaMock.team.findMany).toHaveBeenNthCalledWith(2, {
			where: { deletedAt: null, OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: "499" } }] },
			select: { id: true, name: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500,
		});
		expect(options).toHaveLength(501);
		expect(options.at(-1)).toEqual({ id: "500", name: "500" });
	});

	describe("listTeamsForSession", () => {
		it("keeps customers beyond the first page even when older customers are deleted", async () => {
			prismaMock.team.findMany.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ ...live(`deleted-${i}`), deletedAt: new Date() }))).mockResolvedValueOnce([live("active-later")]);
			const result = await listTeamsForSession(admin);
			expect(result.teams.map((row) => row.id)).toEqual(["active-later"]);
			expect(result.deletedTeams).toHaveLength(500);
		});
		it("gives administrators every customer with counts, deleted ones apart", async () => {
			prismaMock.team.findMany.mockResolvedValue([
				{ ...live("team_a"), _count: { members: 1, servers: 2, storageNodes: 1 } },
				{ ...live("team_b"), deletedAt: new Date(), _count: { members: 0, servers: 1, storageNodes: 1 } },
			]);
			const result = await listTeamsForSession({ ...admin, currentTeamId: "team_a" });
			expect(result.teams.map((team) => team.id)).toEqual(["team_a"]);
			expect(result.deletedTeams.map((team) => team.id)).toEqual(["team_b"]);
			expect(result.currentTeamId).toBe("team_a");
		});

		it("gives a customer account only its own live customer", async () => {
			prismaMock.team.findMany.mockResolvedValue([live("team_a")]);
			const result = await listTeamsForSession(customerAccount);
			expect(prismaMock.team.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "team_a", deletedAt: null } }));
			expect(result.deletedTeams).toEqual([]);
		});
	});

	describe("createTeam", () => {
		it("creates the customer with its own local storage and no membership", async () => {
			prismaMock.team.create.mockResolvedValue({ id: "team_new", slug: "acme", name: "Acme" });
			await createTeam({ name: " Acme " }, admin);
			expect(prismaMock.team.create).toHaveBeenCalledWith({ data: { slug: "acme", name: "Acme", description: null } });
			expect(prismaMock.storageNode.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ driver: "LOCAL", isDefault: true, teamId: "team_new", basePath: "storage/teams/team_new" }),
			});
			expect(prismaMock.teamMember.upsert).not.toHaveBeenCalled();
		});

		it("retries a generated slug but reports a clash on an explicit one", async () => {
			prismaMock.team.create
				.mockRejectedValueOnce({ code: "P2002" })
				.mockResolvedValueOnce({ id: "team_new", slug: "acme-2", name: "Acme" });
			await createTeam({ name: "Acme" }, admin);
			expect(prismaMock.team.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ slug: "acme-2" }) });

			prismaMock.team.create.mockRejectedValueOnce({ code: "P2002" });
			await expect(createTeam({ name: "Acme", slug: "acme" }, admin)).rejects.toBeInstanceOf(ValidationError);
		});
	});

	describe("deleteTeam / restoreTeam", () => {
		it("marks the customer deleted and returns administrators viewing it to all customers", async () => {
			const result = await deleteTeam("team_a", { ...admin, currentTeamId: "team_a" });
			expect(prismaMock.team.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "team_a", deletedAt: null }, data: { deletedAt: expect.any(Date) } }));
			expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
				where: { currentTeamId: "team_a", teamMembership: { is: null } },
				data: { currentTeamId: null },
			});
			expect(result.nextCurrentTeamId).toBeNull();
			expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "team.delete", teamId: "team_a" }), prismaMock);
		});

		it("refuses to delete a customer that is already deleted", async () => {
			prismaMock.team.updateManyAndReturn.mockResolvedValueOnce([]);
			await expect(deleteTeam("team_a", admin)).rejects.toBeInstanceOf(NotFoundError);
			expect(writeAuditLog).not.toHaveBeenCalled();
		});

		it("restores only a deleted customer", async () => {
			prismaMock.team.updateManyAndReturn.mockResolvedValueOnce([live()]).mockResolvedValueOnce([]);
			await restoreTeam("team_a", admin);
			expect(prismaMock.team.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "team_a", deletedAt: { not: null } }, data: { deletedAt: null } }));

			await expect(restoreTeam("team_a", admin)).rejects.toBeInstanceOf(NotFoundError);
			expect(writeAuditLog).toHaveBeenCalledTimes(1);
		});
	});

	describe("setCustomerMembership", () => {
		beforeEach(() => {
			prismaMock.user.findUnique.mockResolvedValue({ id: "u_x", username: "x", roles: [] });
			prismaMock.identityTemplate.findUnique.mockResolvedValue({ id: "identity:operator" });
		});

		it("puts an account into a customer with its template and makes it current", async () => {
			prismaMock.teamMember.findUnique.mockResolvedValue(null);
			await setCustomerMembership({ teamId: "team_a", userId: "u_x", identityTemplateId: "identity:operator" }, admin);
			expect(prismaMock.teamMember.upsert).toHaveBeenCalledWith({
				where: { userId: "u_x" },
				create: { teamId: "team_a", userId: "u_x", identityTemplateId: "identity:operator" },
				update: { identityTemplateId: "identity:operator" },
			});
			expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_x" }, data: { currentTeamId: "team_a" } });
		});

		it("drops the old customer's per-resource narrowing when moving an account", async () => {
			// The competing first assignment becomes visible once its user lock is released.
			prismaMock.teamMember.findUnique.mockResolvedValue(null);
			prismaMock.$queryRaw.mockImplementationOnce(async () => {
				prismaMock.teamMember.findUnique.mockResolvedValue({ teamId: "team_old" });
				return [{ id: "u_x" }];
			});
			await setCustomerMembership({ teamId: "team_a", userId: "u_x" }, admin);
			expect(prismaMock.teamMember.delete).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.teamMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ teamId: "team_a" }) }));
			expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_x" }, data: { currentTeamId: "team_a" } });
		});

		it("never puts a platform administrator into a customer", async () => {
			// A concurrent promotion commits while this transaction waits for the target.
			prismaMock.$queryRaw.mockImplementationOnce(async () => {
				prismaMock.user.findUnique.mockResolvedValue({ id: "u_x", roles: [{ role: { key: "admin" } }] });
				return [{ id: "u_x" }];
			});
			await expect(setCustomerMembership({ teamId: "team_a", userId: "u_x" }, admin)).rejects.toBeInstanceOf(ValidationError);
			expect(prismaMock.$queryRaw).toHaveBeenCalledWith(expect.anything(), "u_x");
			expect(prismaMock.teamMember.findUnique).toHaveBeenCalledWith({ where: { userId: "u_x" }, select: { teamId: true } });
			expect(prismaMock.teamMember.upsert).not.toHaveBeenCalled();
		});

		it("rejects an unknown identity template", async () => {
			prismaMock.identityTemplate.findUnique.mockResolvedValue(null);
			await expect(setCustomerMembership({ teamId: "team_a", userId: "u_x", identityTemplateId: "missing" }, admin)).rejects.toBeInstanceOf(NotFoundError);
		});
	});

	describe("updateTeamMemberTemplate", () => {
		beforeEach(() => {
			prismaMock.identityTemplate.findUnique.mockResolvedValue({ id: "tpl" });
		});

		it("only updates the template of the named membership", async () => {
			prismaMock.teamMember.updateMany.mockResolvedValue({ count: 1 });
			const member = { teamId: "team_a", userId: "u_x", identityTemplateId: "tpl" };
			await expect(updateTeamMemberTemplate("team_a", "u_x", "tpl", admin)).resolves.toEqual(member);
			expect(prismaMock.teamMember.updateMany).toHaveBeenCalledWith({ where: { teamId: "team_a", userId: "u_x" }, data: { identityTemplateId: "tpl" } });
			expect(auditUserActionMock).toHaveBeenCalledWith(admin.userId, "team.member.set", member, undefined, "team_a");
			expect(prismaMock.user.update).not.toHaveBeenCalled();
		});

		it("returns not found for a member of another customer and preserves all grants", async () => {
			prismaMock.teamMember.updateMany.mockResolvedValue({ count: 0 });
			await expect(updateTeamMemberTemplate("team_a", "u_x", "tpl", admin)).rejects.toBeInstanceOf(NotFoundError);
			expect(prismaMock.teamMember.upsert).not.toHaveBeenCalled();
			expect(prismaMock.teamMember.delete).not.toHaveBeenCalled();
			expect(prismaMock.userServerAccess.deleteMany).not.toHaveBeenCalled();
			expect(prismaMock.userStorageAccess.deleteMany).not.toHaveBeenCalled();
			expect(prismaMock.user.update).not.toHaveBeenCalled();
			expect(auditUserActionMock).not.toHaveBeenCalled();
		});
	});

	describe("removeTeamMember", () => {
		it("removes the membership, its narrowing and the current customer", async () => {
			prismaMock.teamMember.deleteMany.mockResolvedValue({ count: 1 });
			await removeTeamMember("team_a", "u_x", admin);
			expect(prismaMock.$queryRaw).toHaveBeenCalledWith(expect.anything(), "u_x");
			expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prismaMock.teamMember.deleteMany.mock.invocationCallOrder[0]!);
			expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team_a", userId: "u_x" } });
			expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_x" }, data: { currentTeamId: null } });
		});

		it("refuses an account of another customer", async () => {
			prismaMock.teamMember.deleteMany.mockResolvedValue({ count: 0 });
			await expect(removeTeamMember("team_a", "u_x", admin)).rejects.toBeInstanceOf(NotFoundError);
			expect(prismaMock.userServerAccess.deleteMany).not.toHaveBeenCalled();
			expect(prismaMock.userStorageAccess.deleteMany).not.toHaveBeenCalled();
			expect(prismaMock.user.update).not.toHaveBeenCalled();
			expect(auditUserActionMock).not.toHaveBeenCalled();
		});
	});

	describe("switchCurrentTeam", () => {
		it("selects a live customer or all customers", async () => {
			await expect(switchCurrentTeam("team_b", admin)).resolves.toMatchObject({ id: "team_b" });
			expect(prismaMock.user.update).toHaveBeenLastCalledWith({ where: { id: "u_admin" }, data: { currentTeamId: "team_b" } });
			await expect(switchCurrentTeam(null, admin)).resolves.toBeNull();
			expect(prismaMock.user.update).toHaveBeenLastCalledWith({ where: { id: "u_admin" }, data: { currentTeamId: null } });
		});

		it("refuses a deleted customer", async () => {
			prismaMock.$queryRaw.mockResolvedValueOnce([]);
			await expect(switchCurrentTeam("team_b", admin)).rejects.toBeInstanceOf(NotFoundError);
		});
	});
});
