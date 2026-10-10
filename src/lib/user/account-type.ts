/**
 * Account types: a platform administrator (role `admin`, no customer) or a
 * customer account (one customer membership with an identity template).
 */
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { setCustomerMembership } from "@/lib/team/service";
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

export async function setAccountType(userId: string, input: AccountTypeInput, session: SessionPayload) {
  if (input.type === "admin") {
    await makePlatformAdmin(userId);
    return;
  }
  // Demoting an administrator must leave at least one active administrator.
  await withAdminInvariantLock(async () => {
    await assertAdminAccessMayBeRemoved(userId);
    await prisma.userRole.deleteMany({ where: { userId } });
  });
  await setCustomerMembership({ userId, teamId: input.teamId, identityTemplateId: input.identityTemplateId }, session);
}
