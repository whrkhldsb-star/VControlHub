import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const { prismaMock, auditUserActionMock } = vi.hoisted(() => ({
	prismaMock: {
		team: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
		teamMember: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
		user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
		server: { updateMany: vi.fn() },
		$transaction: vi.fn(),
	},
	auditUserActionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));

const { createTeam, switchCurrentTeam, addTeamMember, deleteTeam, listTeamsForSession, isDeletedTeamSlug } =
	await import("../service");

const adminSession: SessionPayload = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };
const viewerSession: SessionPayload = { userId: "u_viewer", username: "viewer", roles: ["viewer"], mustChangePassword: false, currentTeamId: null };

describe("team workspace service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
	});

	it("creates a team, owner membership, and switches current team for the creator", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce(null);
		prismaMock.team.create.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });
		prismaMock.teamMember.create.mockResolvedValueOnce({});
		prismaMock.user.update.mockResolvedValueOnce({});

		await expect(createTeam({ name: "Ops", slug: "ops", description: null }, adminSession)).resolves.toMatchObject({ id: "team_1", slug: "ops" });
		expect(prismaMock.teamMember.create).toHaveBeenCalledWith({ data: { teamId: "team_1", userId: "u_admin", role: "owner" } });
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

	it("rejects a team slug that uses the reserved deleted-workspace prefix", async () => {
		await expect(
			createTeam({ name: "Ghost", slug: "__deleted__ghost", description: null }, adminSession),
		).rejects.toThrow("该团队标识为系统保留");
		expect(prismaMock.team.create).not.toHaveBeenCalled();
	});

	it("tombstones a deleted workspace instead of dropping the row", async () => {
		prismaMock.team.findUnique.mockResolvedValueOnce({ id: "team_1", slug: "ops", name: "Ops" });

		await expect(deleteTeam("team_1", adminSession)).resolves.toEqual({ deleted: true });

		// Hard-deleting the row would SetNull every teamId on the workspace's data,
		// and `teamWhere()` reads null as "shared with every tenant".
		expect(prismaMock.team.delete).not.toHaveBeenCalled();
		expect(prismaMock.server.updateMany).not.toHaveBeenCalled();
		expect(prismaMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team_1" } });
		expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
			where: { currentTeamId: "team_1" },
			data: { currentTeamId: null },
		});
		const update = prismaMock.team.update.mock.calls[0]?.[0];
		expect(update.where).toEqual({ id: "team_1" });
		expect(update.data.ownerId).toBeNull();
		expect(isDeletedTeamSlug(update.data.slug)).toBe(true);
		// The original slug is released for reuse.
		expect(update.data.slug).not.toBe("ops");
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
		expect(where).toMatchObject({ NOT: { slug: { startsWith: "__deleted__" } } });
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
});
