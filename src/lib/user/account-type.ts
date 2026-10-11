/**
 * Account types: a platform administrator (role `admin`, no customer) or a
 * customer account (one customer membership with an identity template).
 */
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { applyCustomerMembership, assertPlatformAdmin, resolveCustomerMembershipTarget } from "@/lib/team/service";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "./admin-invariant";

export type AccountTypeInput =
  | { type: "admin" }
  | { type: "customer"; teamId: string; identityTemplateId?: string | null };

async function adminRoleId() {
  const role = await prisma.role.findUnique({ where: { key: "admin" }, select: { id: true } });
  if (!role) throw new ValidationError(t("backend.user.roleNotFound", { roles: "admin" }));
  return role.id;
}

/** Make the account a platform administrator: it leaves any customer. */
async function makePlatformAdmin(userId: string) {
  const roleId = await adminRoleId();
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { userId } }),
    prisma.userServerAccess.deleteMany({ where: { userId } }),
    prisma.userStorageAccess.deleteMany({ where: { userId } }),
    prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    }),
  ]);
}

/**
 * Make the account a customer account of `teamId`. Every check runs before
 * the first write, and the role removal and the membership land in one
 * transaction: a failure never leaves an account without roles and without
 * a customer.
 */
async function makeCustomerAccount(userId: string, teamId: string, identityTemplateId: string | null | undefined) {
  const target = await resolveCustomerMembershipTarget(teamId, identityTemplateId);
  // Demoting an administrator must leave at least one active administrator.
  await withAdminInvariantLock(async () => {
    await assertAdminAccessMayBeRemoved(userId);
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await applyCustomerMembership(tx, { userId, ...target });
    });
  });
}

/** The caller audits the change (`user.permission_update` carries the account input). */
export async function setAccountType(userId: string, input: AccountTypeInput, session: SessionPayload) {
  assertPlatformAdmin(session);
  if (input.type === "admin") {
    await makePlatformAdmin(userId);
    return;
  }
  await makeCustomerAccount(userId, input.teamId, input.identityTemplateId);
}
