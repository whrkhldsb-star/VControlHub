import type { Prisma } from "@prisma/client";
/**
 * Account types: a platform administrator (role `admin`, no customer) or a
 * customer account (one customer membership with an identity template).
 */
import { assertSessionCredentialBinding, type SessionPayload } from "@/lib/auth/session";
import { AuthError, ForbiddenError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { applyCustomerMembership, lockLiveCustomer, resolveCustomerMembershipTarget } from "@/lib/team/service";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "./admin-invariant";
import { lockUserRow } from "./row-lock";

export type AccountTypeInput =
  | { type: "admin" }
  | { type: "customer"; teamId: string; identityTemplateId?: string | null };

/** Recheck the cookie and platform-only user:manage permission while the actor is locked. */
export async function assertCurrentUserManager(tx: Prisma.TransactionClient, session: SessionPayload): Promise<void> {
  // Lock the role grant as well as the user. A Serializable transaction may
  // have taken its snapshot before a concurrent role-only revocation committed.
  const [actor] = await tx.$queryRaw<Array<{
    status: string;
    passwordHash: string;
    sessionEpoch: number;
    mustChangePassword: boolean;
  }>>`
    SELECT u.status, u."passwordHash", u."sessionEpoch", u."mustChangePassword"
    FROM "User" u
    JOIN "UserRole" ur ON ur."userId" = u.id
    JOIN "Role" r ON r.id = ur."roleId"
    WHERE u.id = ${session.userId} AND r.key = 'admin'
    FOR UPDATE OF u FOR SHARE OF ur, r
  `;
  if (!actor) throw new ForbiddenError(t("backend.customer.platformOnly"));
  if (actor.status !== "ACTIVE" || actor.mustChangePassword) {
    throw new AuthError(t("backend.auth.sessionCredentialsChanged"));
  }
  assertSessionCredentialBinding(session, actor);
}

/** All permission reads and writes for this target share the actor and target locks. */
export async function withAccountPermissionChange<T>(
  userId: string,
  session: SessionPayload,
  operation: (tx: Prisma.TransactionClient, changeType: (input: AccountTypeInput) => Promise<void>) => Promise<T>,
  transaction?: Prisma.TransactionClient,
): Promise<T> {
  assertPlatformAdmin(session);
  return withAdminInvariantLock(async (tx) => {
    await assertCurrentUserManager(tx, session);
    await lockUserRow(tx, userId);
    const membership = await tx.teamMember.findUnique({ where: { userId }, select: { teamId: true } });
    if (membership) await lockLiveCustomer(tx, membership.teamId);
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
  return withAccountPermissionChange(userId, session, (_tx, changeType) => changeType(input), tx);
}
