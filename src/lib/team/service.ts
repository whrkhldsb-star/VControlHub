import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import type { AddTeamMemberInput, CreateTeamInput, UpdateTeamInput } from "./schema";

export type TeamRole = "owner" | "admin" | "member";

function slugifyTeamName(name: string) {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64) || `team-${Date.now().toString(36)}`;
}

async function uniqueTeamSlug(base: string) {
	let slug = base;
	for (let i = 2; i < 100; i++) {
		const existing = await prisma.team.findUnique({ where: { slug }, select: { id: true } });
		if (!existing) return slug;
		slug = `${base.slice(0, 56)}-${i}`;
	}
	throw new ValidationError("Unable to generate a unique team identifier");
}

export async function listTeamsForSession(session: SessionPayload) {
	const canManageAll = sessionHasPermission(session, "team:manage");
	const teams = await prisma.team.findMany({
		where: canManageAll ? undefined : { members: { some: { userId: session.userId } } },
		orderBy: [{ createdAt: "asc" }],
		take: 200,
		select: {
			id: true,
			slug: true,
			name: true,
			description: true,
			ownerId: true,
			createdAt: true,
			members: {
				orderBy: [{ joinedAt: "asc" }],
				select: {
					role: true,
					joinedAt: true,
					user: { select: { id: true, username: true, displayName: true, status: true } },
				},
			},
		},
	});
	const current = await prisma.user.findUnique({
		where: { id: session.userId },
		select: { currentTeamId: true },
	});
	return { teams, currentTeamId: current?.currentTeamId ?? null };
}

export async function createTeam(input: CreateTeamInput, session: SessionPayload) {
	if (!sessionHasPermission(session, "team:create")) {
		throw new ForbiddenError("Missing permission to create team workspace");
	}
	const baseSlug = input.slug?.trim() || slugifyTeamName(input.name);
	const slug = await uniqueTeamSlug(baseSlug);
	const team = await prisma.$transaction(async (tx) => {
		const created = await tx.team.create({
			data: {
				slug,
				name: input.name.trim(),
				description: input.description?.trim() || null,
				ownerId: session.userId,
			},
		});
		await tx.teamMember.create({ data: { teamId: created.id, userId: session.userId, role: "owner" } });
		await tx.user.update({ where: { id: session.userId }, data: { currentTeamId: created.id } });
		return created;
	});
	await auditUserAction(session.userId, "team.create", { teamId: team.id, slug: team.slug, name: team.name });
	return team;
}

async function assertCanManageTeam(session: SessionPayload, teamId: string) {
	if (sessionHasPermission(session, "team:manage")) return;
	const membership = await prisma.teamMember.findUnique({
		where: { teamId_userId: { teamId, userId: session.userId } },
		select: { role: true },
	});
	if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
		throw new ForbiddenError("Missing team workspace management permission");
	}
}

export async function switchCurrentTeam(teamId: string, session: SessionPayload) {
	const membership = await prisma.teamMember.findUnique({
		where: { teamId_userId: { teamId, userId: session.userId } },
		select: { team: { select: { id: true, name: true, slug: true } } },
	});
	if (!membership) throw new ForbiddenError("Can only switch to a team workspace you belong to");
	await prisma.user.update({ where: { id: session.userId }, data: { currentTeamId: teamId } });
	await auditUserAction(session.userId, "team.switch", { teamId, slug: membership.team.slug });
	return membership.team;
}

export async function addTeamMember(teamId: string, input: AddTeamMemberInput, session: SessionPayload) {
	await assertCanManageTeam(session, teamId);
	const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, slug: true } });
	if (!team) throw new NotFoundError("Team workspace not found");
	const user = await prisma.user.findUnique({ where: { username: input.username }, select: { id: true, username: true } });
	if (!user) throw new NotFoundError("User not found");
	const member = await prisma.teamMember.upsert({
		where: { teamId_userId: { teamId, userId: user.id } },
		update: { role: input.role },
		create: { teamId, userId: user.id, role: input.role },
		select: { role: true, user: { select: { id: true, username: true, displayName: true, status: true } } },
	});
	await auditUserAction(session.userId, "team.member.upsert", { teamId, teamSlug: team.slug, username: user.username, role: input.role });
	return member;
}

export async function removeTeamMember(teamId: string, userId: string, session: SessionPayload) {
	await assertCanManageTeam(session, teamId);
	const team = await prisma.team.findUnique({
		where: { id: teamId },
		select: { id: true, slug: true, ownerId: true },
	});
	if (!team) throw new NotFoundError("Team workspace not found");

	// Prevent removing the team owner
	if (team.ownerId === userId) {
		throw new ForbiddenError("Cannot remove the team owner; please transfer ownership first");
	}

	// Prevent removing the last owner
	const membership = await prisma.teamMember.findUnique({
		where: { teamId_userId: { teamId, userId } },
		select: { role: true },
	});
	if (!membership) throw new NotFoundError("This user is not a team member");
	if (membership.role === "owner") {
		const ownerCount = await prisma.teamMember.count({ where: { teamId, role: "owner" } });
		if (ownerCount <= 1) {
			throw new ForbiddenError("Cannot remove the last owner; please transfer ownership first");
		}
	}

	await prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });

	// If the removed user's currentTeamId was this team, clear it
	await prisma.user.updateMany({
		where: { id: userId, currentTeamId: teamId },
		data: { currentTeamId: null },
	});

	await auditUserAction(session.userId, "team.member.remove", { teamId, teamSlug: team.slug, removedUserId: userId });
	return { removed: true };
}

export async function updateTeam(teamId: string, input: UpdateTeamInput, session: SessionPayload) {
	await assertCanManageTeam(session, teamId);
	const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, slug: true } });
	if (!team) throw new NotFoundError("Team workspace not found");

	const data: { name?: string; description?: string | null } = {};
	if (input.name !== undefined) data.name = input.name.trim();
	if (input.description !== undefined) data.description = input.description?.trim() || null;

	const updated = await prisma.team.update({
		where: { id: teamId },
		data,
		select: { id: true, slug: true, name: true, description: true },
	});

	await auditUserAction(session.userId, "team.update", { teamId, teamSlug: team.slug, fields: Object.keys(data) });
	return updated;
}

export async function deleteTeam(teamId: string, session: SessionPayload) {
	// Only team:manage (global admin) or team owner can delete
	if (!sessionHasPermission(session, "team:manage")) {
		const membership = await prisma.teamMember.findUnique({
			where: { teamId_userId: { teamId, userId: session.userId } },
			select: { role: true },
		});
		if (!membership || membership.role !== "owner") {
			throw new ForbiddenError("Only an admin or team owner can delete the team");
		}
	}

	const team = await prisma.team.findUnique({
		where: { id: teamId },
		select: { id: true, slug: true, name: true },
	});
	if (!team) throw new NotFoundError("Team workspace not found");

	await prisma.$transaction(async (tx) => {
		// Clear currentTeamId for users pointing to this team
		await tx.user.updateMany({
			where: { currentTeamId: teamId },
			data: { currentTeamId: null },
		});
		// Null out teamId on servers belonging to this team
		await tx.server.updateMany({
			where: { teamId },
			data: { teamId: null },
		});
		// Delete team members (cascade)
		await tx.teamMember.deleteMany({ where: { teamId } });
		// Delete the team
		await tx.team.delete({ where: { id: teamId } });
	});

	await auditUserAction(session.userId, "team.delete", { teamId, teamSlug: team.slug, teamName: team.name });
	return { deleted: true };
}
