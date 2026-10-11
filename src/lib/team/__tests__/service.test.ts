import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

const { prismaMock, auditUserActionMock } = vi.hoisted(() => ({
	prismaMock: {
		team: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
		teamMember: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
		user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
		identityTemplate: { findUnique: vi.fn() },
		storageNode: { create: vi.fn() },
		userServerAccess: { deleteMany: vi.fn() },
		userStorageAccess: { deleteMany: vi.fn() },
		$transaction: vi.fn(),
	},
	auditUserActionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock, isUniqueViolation: (e: unknown) => (e as { code?: string })?.code === "P2002" }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));

const {
	createTeam,
	deleteTeam,
	listTeamsForSession,
	removeTeamMember,
	restoreTeam,
	setCustomerMembership,
	switchCurrentTeam,
	updateTeam,
} = await import("../service");

const admin: SessionPayload = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };
const customerAccount: SessionPayload = { userId: "u_c", username: "carol", roles: [], permissions: ["team:read"], mustChangePassword: false, currentTeamId: "team_a" };
const live = (id = "team_a") => ({ id, slug: id, name: id.toUpperCase(), deletedAt: null });

describe("customer service", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		prismaMock.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as unknown[])));
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
			["removeTeamMember", () => removeTeamMember("team_a", "u_x", customerAccount)],
		])("refuses %s for a customer account", async (_name, run) => {
			await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
		});
	});

	describe("listTeamsForSession", () => {
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
			expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: "team_a" }, data: { deletedAt: expect.any(Date) } });
			expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
				where: { currentTeamId: "team_a", teamMembership: { is: null } },
				data: { currentTeamId: null },
			});
			expect(result.nextCurrentTeamId).toBeNull();
		});

		it("refuses to delete a customer that is already deleted", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ ...live(), deletedAt: new Date() });
			await expect(deleteTeam("team_a", admin)).rejects.toBeInstanceOf(NotFoundError);
		});

		it("restores only a deleted customer", async () => {
			prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_a", slug: "a", deletedAt: new Date() });
			await restoreTeam("team_a", admin);
			expect(prismaMock.team.update).toHaveBeenCalledWith({ where: { id: "team_a" }, data: { deletedAt: null } });

			await expect(restoreTeam("team_a", admin)).rejects.toBeInstanceOf(NotFoundError);
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
			prismaMock.teamMember.findUnique.mockResolvedValue({ teamId: "team_old" });
			await setCustomerMembership({ teamId: "team_a", userId: "u_x" }, admin);
			expect(prismaMock.teamMember.delete).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.userServerAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.userStorageAccess.deleteMany).toHaveBeenCalledWith({ where: { userId: "u_x" } });
		});

		it("never puts a platform administrator into a customer", async () => {
			prismaMock.user.findUnique.mockResolvedValue({ id: "u_x", username: "x", roles: [{ role: { key: "admin" } }] });
			await expect(setCustomerMembership({ teamId: "team_a", userId: "u_x" }, admin)).rejects.toBeInstanceOf(ValidationError);
		});

		it("rejects an unknown identity template", async () => {
			prismaMock.identityTemplate.findUnique.mockResolvedValue(null);
			await expect(setCustomerMembership({ teamId: "team_a", userId: "u_x", identityTemplateId: "missing" }, admin)).rejects.toBeInstanceOf(NotFoundError);
		});
	});

	describe("removeTeamMember", () => {
		it("removes the membership, its narrowing and the current customer", async () => {
			prismaMock.teamMember.findUnique.mockResolvedValue({ teamId: "team_a" });
			await removeTeamMember("team_a", "u_x", admin);
			expect(prismaMock.teamMember.delete).toHaveBeenCalledWith({ where: { userId: "u_x" } });
			expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u_x" }, data: { currentTeamId: null } });
		});

		it("refuses an account of another customer", async () => {
			prismaMock.teamMember.findUnique.mockResolvedValue({ teamId: "team_b" });
			await expect(removeTeamMember("team_a", "u_x", admin)).rejects.toBeInstanceOf(NotFoundError);
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
			prismaMock.team.findUnique.mockResolvedValueOnce({ ...live("team_b"), deletedAt: new Date() });
			await expect(switchCurrentTeam("team_b", admin)).rejects.toBeInstanceOf(NotFoundError);
		});
	});
});
