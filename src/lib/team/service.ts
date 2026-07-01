import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import type { AddTeamMemberInput, CreateTeamInput } from "./schema";

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
	throw new ValidationError("无法生成唯一团队标识");
}

export async function listTeamsForSession(session: SessionPayload) {
	const canManageUsers = sessionHasPermission(session, "user:manage");
	const teams = await prisma.team.findMany({
		where: canManageUsers ? undefined : { members: { some: { userId: session.userId } } },
		orderBy: [{ createdAt: "asc" }],
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
	if (!sessionHasPermission(session, "user:manage")) {
		throw new ForbiddenError("缺少团队空间管理权限");
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
	auditUserAction(session.userId, "team.create", { teamId: team.id, slug: team.slug, name: team.name });
	return team;
}

async function assertCanManageTeam(session: SessionPayload, teamId: string) {
	if (sessionHasPermission(session, "user:manage")) return;
	const membership = await prisma.teamMember.findUnique({
		where: { teamId_userId: { teamId, userId: session.userId } },
		select: { role: true },
	});
	if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
		throw new ForbiddenError("缺少团队空间管理权限");
	}
}

export async function switchCurrentTeam(teamId: string, session: SessionPayload) {
	const membership = await prisma.teamMember.findUnique({
		where: { teamId_userId: { teamId, userId: session.userId } },
		select: { team: { select: { id: true, name: true, slug: true } } },
	});
	if (!membership) throw new ForbiddenError("只能切换到自己所属的团队空间");
	await prisma.user.update({ where: { id: session.userId }, data: { currentTeamId: teamId } });
	auditUserAction(session.userId, "team.switch", { teamId, slug: membership.team.slug });
	return membership.team;
}

export async function addTeamMember(teamId: string, input: AddTeamMemberInput, session: SessionPayload) {
	await assertCanManageTeam(session, teamId);
	const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, slug: true } });
	if (!team) throw new NotFoundError("团队空间不存在");
	const user = await prisma.user.findUnique({ where: { username: input.username }, select: { id: true, username: true } });
	if (!user) throw new NotFoundError("用户不存在");
	const member = await prisma.teamMember.upsert({
		where: { teamId_userId: { teamId, userId: user.id } },
		update: { role: input.role },
		create: { teamId, userId: user.id, role: input.role },
		select: { role: true, user: { select: { id: true, username: true, displayName: true, status: true } } },
	});
	auditUserAction(session.userId, "team.member.upsert", { teamId, teamSlug: team.slug, username: user.username, role: input.role });
	return member;
}
