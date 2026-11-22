import type { Prisma } from "@prisma/client";
/**
 * Account types: a platform administrator (role `admin`, no customer) or a
 * customer account (one customer membership with an identity template).
 */
import type { SessionPayload } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { applyCustomerMembership, resolveCustomerMembershipTarget } from "@/lib/team/service";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "./admin-invariant";
import { lockManagedAccount } from "./row-lock";

export { assertCurrentUserManager } from "./row-lock";

export type AccountTypeInput =
  | { type: "admin" }
  | { type: "customer"; teamId: string; identityTemplateId?: string | null };

/** All permission reads and writes for this target share the actor and target locks. */
export async function withAccountPermissionChange<T>(
  userId: string,
  session: SessionPayload,
  operation: (tx: Prisma.TransactionClient, changeType: (input: AccountTypeInput) => Promise<void>) => Promise<T>,
  transaction?: Prisma.TransactionClient,
  destinationTeamId?: string,
): Promise<T> {
  assertPlatformAdmin(session);
  return withAdminInvariantLock(async (tx) => {
    await lockManagedAccount(tx, session, userId, destinationTeamId);
    return operation(tx, (input) => applyAccountType(tx, userId, input));
  }, transaction);
}

async function applyAccountType(tx: Prisma.TransactionClient, userId: string, input: AccountTypeInput) {
  if (input.type === "admin") {
    const role = await tx.role.findUnique({ where: { key: "admin" }, select: { id: true } });
    if (!role) throw new ValidationError(t("backend.user.roleNotFound", { roles: "admin" }));
    await tx.teamMember.deleteMany({ where: { userId } });
    await tx.userServerAccess.deleteMany({ where: { userId } });
    await tx.userStorageAccess.deleteMany({ where: { userId } });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {}, create: { userId, roleId: role.id },
    });
    return;
  }
  const target = await resolveCustomerMembershipTarget(input.teamId, input.identityTemplateId, tx);
  await assertAdminAccessMayBeRemoved(userId, tx);
  await tx.userRole.deleteMany({ where: { userId } });
  await applyCustomerMembership(tx, { userId, ...target });
}

export function setAccountType(userId: string, input: AccountTypeInput, session: SessionPayload, tx?: Prisma.TransactionClient) {
  return withAccountPermissionChange(userId, session, (_tx, changeType) => changeType(input), tx, input.type === "customer" ? input.teamId : undefined);
}
