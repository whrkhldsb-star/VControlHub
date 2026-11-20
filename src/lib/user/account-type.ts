import type { Prisma } from "@prisma/client";
/**
 * Account types: a platform administrator (role `admin`, no customer) or a
 * customer account (one customer membership with an identity template).
 */
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { applyCustomerMembership, resolveCustomerMembershipTarget } from "@/lib/team/service";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "./admin-invariant";

export type AccountTypeInput =
  | { type: "admin" }
  | { type: "customer"; teamId: string; identityTemplateId?: string | null };

/** Callers supplying a transaction hold the same administrator invariant lock. */
export async function setAccountType(userId: string, input: AccountTypeInput, session: SessionPayload, transaction?: Prisma.TransactionClient) {
  assertPlatformAdmin(session);
  const apply = async (tx: Prisma.TransactionClient) => {
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
  };
  if (transaction) return apply(transaction);
  await withAdminInvariantLock(() => prisma.$transaction(apply));
}
