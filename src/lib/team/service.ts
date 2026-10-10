/**
 * Customers (stored as `Team` rows).
 *
 * The platform creates customers and their accounts; customers never create
 * or join other customers. A customer account belongs to exactly one customer
 * through its `TeamMember` row, which also carries its identity template.
 * Platform administrators hold no membership and select a customer, or all
 * customers, per browser session.
 *
 * Deletion sets `deletedAt` and keeps every row: the customer's data stays
 * scoped and unreachable, and restoring clears the field.
 */
import { prisma, isUniqueViolation } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { t } from "@/lib/i18n/service-translations";
import { tenantStorageBasePath } from "@/lib/storage/path-utils";
import { DEFAULT_IDENTITY_TEMPLATE_ID } from "@/lib/auth/identity-templates";
import type { CreateTeamInput, UpdateTeamInput } from "./schema";

function assertPlatformAdmin(session: SessionPayload) {
  if (!isGlobalTeamManager(session)) throw new ForbiddenError(t("backend.customer.platformOnly"));
}

async function findLiveCustomer(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, slug: true, name: true, deletedAt: true } });
  if (!team || team.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));
  return team;
}

function slugifyName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56)
    || `customer-${Date.now().toString(36)}`;
}

const CUSTOMER_SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  createdAt: true,
  deletedAt: true,
  _count: { select: { members: true, servers: true, storageNodes: true } },
} as const;

/**
 * Administrators: every customer with resource counts, deleted ones listed
 * separately. Customer accounts: their own customer only.
 */
export async function listTeamsForSession(session: SessionPayload) {
  if (isGlobalTeamManager(session)) {
    const all = await prisma.team.findMany({ orderBy: [{ createdAt: "asc" }], take: 500, select: CUSTOMER_SUMMARY_SELECT });
    return {
      teams: all.filter((team) => !team.deletedAt),
      deletedTeams: all.filter((team) => team.deletedAt),
      currentTeamId: session.currentTeamId,
    };
  }
  const teams = session.currentTeamId
    ? await prisma.team.findMany({
        where: { id: session.currentTeamId, deletedAt: null },
        select: { id: true, slug: true, name: true, description: true, createdAt: true },
      })
    : [];
  return { teams, deletedTeams: [], currentTeamId: session.currentTeamId };
}

/** Members of one customer with their identity templates (administrators only). */
export async function listCustomerMembers(teamId: string, session: SessionPayload) {
  assertPlatformAdmin(session);
  await findLiveCustomer(teamId);
  return prisma.teamMember.findMany({
    where: { teamId },
    orderBy: [{ joinedAt: "asc" }],
    select: {
      joinedAt: true,
      identityTemplate: { select: { id: true, name: true, isBuiltin: true } },
      user: { select: { id: true, username: true, displayName: true, status: true } },
    },
  });
}

export async function createTeam(input: CreateTeamInput, session: SessionPayload) {
  assertPlatformAdmin(session);
  const name = input.name.trim();
  const baseSlug = input.slug?.trim() || slugifyName(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      const team = await prisma.$transaction(async (tx) => {
        const created = await tx.team.create({
          data: { slug, name, description: input.description?.trim() || null },
        });
        // Every customer starts with its own isolated local storage root.
        await tx.storageNode.create({
          data: {
            name: t("backend.customer.defaultStorageName", { name }),
            driver: "LOCAL",
            basePath: tenantStorageBasePath(created.id),
            isDefault: true,
            teamId: created.id,
          },
        });
        return created;
      });
      await auditUserAction(session.userId, "team.create", { teamId: team.id, slug: team.slug, name: team.name }, undefined, team.id);
      return team;
    } catch (error) {
      // An explicit slug is the administrator's choice: report the clash.
      if (isUniqueViolation(error) && !input.slug) continue;
      if (isUniqueViolation(error)) throw new ValidationError(t("backend.customer.slugTaken"));
      throw error;
    }
  }
  throw new ValidationError(t("backend.customer.slugTaken"));
}

export async function updateTeam(teamId: string, input: UpdateTeamInput, session: SessionPayload) {
  assertPlatformAdmin(session);
  await findLiveCustomer(teamId);
  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    },
  });
  await auditUserAction(session.userId, "team.update", { teamId, name: updated.name }, undefined, teamId);
  return updated;
}

/** Hide the customer and its data; members lose access until it is restored. */
export async function deleteTeam(teamId: string, session: SessionPayload) {
  assertPlatformAdmin(session);
  const team = await findLiveCustomer(teamId);
  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
    // Administrators viewing this customer fall back to "all customers".
    await tx.user.updateMany({ where: { currentTeamId: teamId, teamMembership: { is: null } }, data: { currentTeamId: null } });
  });
  await auditUserAction(session.userId, "team.delete", { teamId, slug: team.slug, name: team.name }, undefined, teamId);
  return { nextCurrentTeamId: session.currentTeamId === teamId ? null : session.currentTeamId };
}

export async function restoreTeam(teamId: string, session: SessionPayload) {
  assertPlatformAdmin(session);
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, slug: true, deletedAt: true } });
  if (!team?.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));
  await prisma.team.update({ where: { id: teamId }, data: { deletedAt: null } });
  await auditUserAction(session.userId, "team.restore", { teamId, slug: team.slug }, undefined, teamId);
}

/**
 * Put a customer account into a customer with an identity template. An
 * account has at most one customer, so this also moves it between customers.
 */
export async function setCustomerMembership(
  input: { teamId: string; userId: string; identityTemplateId?: string | null },
  session: SessionPayload,
) {
  assertPlatformAdmin(session);
  await findLiveCustomer(input.teamId);
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, roles: { select: { role: { select: { key: true } } } } },
  });
  if (!user) throw new NotFoundError(t("backend.team.userNotFound"));
  if (user.roles.some((entry) => entry.role.key === "admin")) {
    throw new ValidationError(t("backend.customer.adminHasNoCustomer"));
  }
  const identityTemplateId = input.identityTemplateId || DEFAULT_IDENTITY_TEMPLATE_ID;
  const template = await prisma.identityTemplate.findUnique({ where: { id: identityTemplateId }, select: { id: true } });
  if (!template) throw new NotFoundError(t("backend.customer.templateNotFound"));
  await prisma.$transaction(async (tx) => {
    const previous = await tx.teamMember.findUnique({ where: { userId: user.id }, select: { teamId: true } });
    if (previous && previous.teamId !== input.teamId) {
      // Per-server narrowing belongs to the old customer's servers.
      await tx.teamMember.delete({ where: { userId: user.id } });
      await tx.userServerAccess.deleteMany({ where: { userId: user.id } });
      await tx.userStorageAccess.deleteMany({ where: { userId: user.id } });
    }
    await tx.teamMember.upsert({
      where: { userId: user.id },
      create: { teamId: input.teamId, userId: user.id, identityTemplateId },
      update: { identityTemplateId },
    });
    await tx.user.update({ where: { id: user.id }, data: { currentTeamId: input.teamId } });
  });
  await auditUserAction(session.userId, "team.member.set", { teamId: input.teamId, userId: user.id, identityTemplateId }, undefined, input.teamId);
  return { teamId: input.teamId, userId: user.id, identityTemplateId };
}

export async function removeTeamMember(teamId: string, userId: string, session: SessionPayload) {
  assertPlatformAdmin(session);
  const membership = await prisma.teamMember.findUnique({ where: { userId }, select: { teamId: true } });
  if (!membership || membership.teamId !== teamId) throw new NotFoundError(t("backend.team.thisUserIsNotATeamMember"));
  await prisma.$transaction([
    prisma.teamMember.delete({ where: { userId } }),
    prisma.userServerAccess.deleteMany({ where: { userId } }),
    prisma.userStorageAccess.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { currentTeamId: null } }),
  ]);
  await auditUserAction(session.userId, "team.member.remove", { teamId, userId }, undefined, teamId);
}

/** Administrators choose a customer to work in, or null for all customers. */
export async function switchCurrentTeam(teamId: string | null, session: SessionPayload) {
  assertPlatformAdmin(session);
  const team = teamId ? await findLiveCustomer(teamId) : null;
  await prisma.user.update({ where: { id: session.userId }, data: { currentTeamId: team?.id ?? null } });
  await auditUserAction(session.userId, "team.switch", { teamId: team?.id ?? null, slug: team?.slug ?? null }, undefined, team?.id ?? null);
  return team;
}
