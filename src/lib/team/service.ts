import { prisma, isUniqueViolation } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  UpdateTeamInput,
} from "./schema";
import { t } from "@/lib/i18n/service-translations";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

export type TeamRole = "owner" | "admin" | "member";

/**
 * Reserved slug prefix that marks a workspace as deleted.
 *
 * Almost every tenant-scoped model relates to Team with `onDelete: SetNull`
 * (see prisma/schema.prisma), and `teamWhere()` treats `teamId: null` as
 * "shared/legacy — visible to every tenant". Hard-deleting a Team row would
 * therefore silently re-publish the whole workspace (SSH keys, storage nodes,
 * cloud billing accounts, share links, tickets, cost data, audit logs …) to
 * every other team on the platform. So deletion is a tombstone instead: the
 * row stays, its members are removed and its slug is prefixed, which keeps the
 * data team-scoped and unreachable — no live session can hold this teamId, and
 * `teamWhere()` never matches it for a non-`team:manage` caller.
 */
const DELETED_TEAM_SLUG_PREFIX = "__deleted__";

/** True when the workspace has been tombstoned by {@link deleteTeam}. */
export function isDeletedTeamSlug(slug: string) {
  return slug.startsWith(DELETED_TEAM_SLUG_PREFIX);
}

/** A tombstoned workspace is indistinguishable from a missing one to callers. */
function assertTeamAlive<T extends { slug: string }>(
  team: T | null,
): asserts team is T {
  if (!team || isDeletedTeamSlug(team.slug)) {
    throw new NotFoundError(t("backend.team.teamWorkspaceNotFound"));
  }
}

function slugifyTeamName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || `team-${Date.now().toString(36)}`
  );
}

async function uniqueTeamSlug(base: string) {
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const existing = await prisma.team.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${base.slice(0, 56)}-${i}`;
  }
  throw new ValidationError(
    t("backend.team.unableToGenerateAUniqueTeamIdentifier"),
  );
}

export async function listTeamsForSession(session: SessionPayload) {
  const canManageAll = sessionHasPermission(session, "team:manage");
  const teams = await prisma.team.findMany({
    where: {
      // Tombstoned workspaces stay in the table to keep their data scoped, but
      // they are not real workspaces any more — hide them from everyone.
      NOT: { slug: { startsWith: DELETED_TEAM_SLUG_PREFIX } },
      ...(canManageAll
        ? {}
        : { members: { some: { userId: session.userId } } }),
    },
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
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              status: true,
            },
          },
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

export async function createTeam(
  input: CreateTeamInput,
  session: SessionPayload,
) {
  if (!sessionHasPermission(session, "team:create")) {
    throw new ForbiddenError(
      t("backend.team.missingPermissionToCreateTeamWorkspace"),
    );
  }
  const baseSlug = input.slug?.trim() || slugifyTeamName(input.name);
  if (isDeletedTeamSlug(baseSlug)) {
    // The prefix is reserved for tombstones; a team wearing it would be hidden
    // from its own members the moment it was created.
    throw new ValidationError(t("backend.team.reservedTeamSlug"));
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await uniqueTeamSlug(
      attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`,
    );
    try {
      const team = await prisma.$transaction(async (tx) => {
        const created = await tx.team.create({
          data: {
            slug,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            ownerId: session.userId,
          },
        });
        await tx.teamMember.create({
          data: { teamId: created.id, userId: session.userId, role: "owner" },
        });
        await tx.user.update({
          where: { id: session.userId },
          data: { currentTeamId: created.id },
        });
        return created;
      });
      await auditUserAction(session.userId, "team.create", {
        teamId: team.id,
        slug: team.slug,
        name: team.name,
      });
      return team;
    } catch (error) {
      lastError = error;
      if (isUniqueViolation(error)) continue; // slug race - retry with another slug
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ValidationError(
        t("backend.team.unableToGenerateAUniqueTeamIdentifier"),
      );
}

async function assertCanManageTeam(session: SessionPayload, teamId: string) {
  if (sessionHasPermission(session, "team:manage")) return;
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: session.userId } },
    select: { role: true },
  });
  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "admin")
  ) {
    throw new ForbiddenError(
      t("backend.team.missingTeamWorkspaceManagementPermission"),
    );
  }
}

export async function switchCurrentTeam(
  teamId: string,
  session: SessionPayload,
) {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: session.userId } },
    select: { team: { select: { id: true, name: true, slug: true } } },
  });
  if (!membership)
    throw new ForbiddenError(
      t("backend.team.canOnlySwitchToATeamWorkspaceYou"),
    );
  await prisma.user.update({
    where: { id: session.userId },
    data: { currentTeamId: teamId },
  });
  await auditUserAction(session.userId, "team.switch", {
    teamId,
    slug: membership.team.slug,
  });
  return membership.team;
}

export async function addTeamMember(
  teamId: string,
  input: AddTeamMemberInput,
  session: SessionPayload,
) {
  await assertCanManageTeam(session, teamId);
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, slug: true, ownerId: true },
  });
  assertTeamAlive(team);
  const user = await prisma.user.findUnique({
    where: { username: input.username },
    select: { id: true, username: true },
  });
  if (!user) throw new NotFoundError(t("backend.team.userNotFound"));

  // Never demote the workspace owner via upsert (schema allows only admin|member on this API).
  if (team.ownerId === user.id) {
    throw new ForbiddenError(
      t("backend.team.cannotChangeOwnerRoleViaMemberApi"),
    );
  }
  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
    select: { role: true },
  });
  if (existing?.role === "owner") {
    throw new ForbiddenError(
      t("backend.team.cannotChangeOwnerRoleViaMemberApi"),
    );
  }

  const member = await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: user.id } },
    update: { role: input.role },
    create: { teamId, userId: user.id, role: input.role },
    select: {
      role: true,
      user: {
        select: { id: true, username: true, displayName: true, status: true },
      },
    },
  });
  await auditUserAction(session.userId, "team.member.upsert", {
    teamId,
    teamSlug: team.slug,
    username: user.username,
    role: input.role,
  });
  return member;
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
  session: SessionPayload,
) {
  await assertCanManageTeam(session, teamId);
  const releaseLock = await acquireAdvisoryLock("team-membership", teamId);
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, slug: true, ownerId: true },
    });
    assertTeamAlive(team);

    // Prevent removing the team owner
    if (team.ownerId === userId) {
      throw new ForbiddenError(
        t("backend.team.cannotRemoveTheTeamOwnerPleaseTransferOwnership"),
      );
    }

    // Prevent removing the last owner
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { role: true },
    });
    if (!membership)
      throw new NotFoundError(t("backend.team.thisUserIsNotATeamMember"));
    if (membership.role === "owner") {
      const ownerCount = await prisma.teamMember.count({
        where: { teamId, role: "owner" },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenError(
          t("backend.team.cannotRemoveTheLastOwnerPleaseTransferOwnership"),
        );
      }
    }

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });

    // If the removed user's currentTeamId was this team, clear it
    await prisma.user.updateMany({
      where: { id: userId, currentTeamId: teamId },
      data: { currentTeamId: null },
    });

    await auditUserAction(session.userId, "team.member.remove", {
      teamId,
      teamSlug: team.slug,
      removedUserId: userId,
    });
    return { removed: true };
  } finally {
    await releaseLock();
  }
}

export async function updateTeam(
  teamId: string,
  input: UpdateTeamInput,
  session: SessionPayload,
) {
  await assertCanManageTeam(session, teamId);
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, slug: true },
  });
  assertTeamAlive(team);

  const data: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined)
    data.description = input.description?.trim() || null;

  const updated = await prisma.team.update({
    where: { id: teamId },
    data,
    select: { id: true, slug: true, name: true, description: true },
  });

  await auditUserAction(session.userId, "team.update", {
    teamId,
    teamSlug: team.slug,
    fields: Object.keys(data),
  });
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
      throw new ForbiddenError(
        t("backend.team.onlyAnAdminOrTeamOwnerCanDelete"),
      );
    }
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, slug: true, name: true },
  });
  assertTeamAlive(team);

  // Tombstone rather than hard-delete: see DELETED_TEAM_SLUG_PREFIX. The row
  // keeps owning the workspace's data (servers included — they stay attached to
  // a workspace nobody can reach instead of becoming platform-wide
  // "unassigned"), while every path into it is cut.
  const tombstoneSlug = `${DELETED_TEAM_SLUG_PREFIX}${Date.now().toString(36)}-${team.slug}`.slice(
    0,
    120,
  );
  await prisma.$transaction(async (tx) => {
    // Clear currentTeamId for users pointing to this team
    await tx.user.updateMany({
      where: { currentTeamId: teamId },
      data: { currentTeamId: null },
    });
    // Drop every membership: this is what makes the workspace unreachable, and
    // it frees the original slug for reuse.
    await tx.teamMember.deleteMany({ where: { teamId } });
    await tx.team.update({
      where: { id: teamId },
      data: { slug: tombstoneSlug, ownerId: null },
    });
  });

  await auditUserAction(session.userId, "team.delete", {
    teamId,
    teamSlug: team.slug,
    teamName: team.name,
  });
  return { deleted: true };
}
