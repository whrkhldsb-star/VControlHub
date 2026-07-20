import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const { prismaMock, auditUserActionMock } = vi.hoisted(() => ({
	prismaMock: {
		team: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
		teamMember: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
		user: { findUnique: vi.fn(), update: vi.fn() },
		$transaction: vi.fn(),
	},
	auditUserActionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));

const { createTeam, switchCurrentTeam, addTeamMember } = await import("../service");

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
		expect(auditUserActionMock).toHaveBeenCalledWith("u_admin", "team.create", expect.objectContaining({ teamId: "team_1", slug: "ops" }));
	});

	it("prevents switching to a team the user does not belong to", async () => {
		prismaMock.teamMember.findUnique.mockResolvedValueOnce(null);
		await expect(switchCurrentTeam("team_2", viewerSession)).rejects.toThrow("只能切换到你所属的团队工作区");
		expect(prismaMock.user.update).not.toHaveBeenCalled();
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
