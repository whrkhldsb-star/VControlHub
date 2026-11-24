import type { Prisma } from "@prisma/client";
import { assertSessionCredentialBinding, type SessionPayload } from "@/lib/auth/session";
import { lockLiveCustomer } from "@/lib/auth/team-scope";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** Serialize credential, role and membership decisions for an existing account. */
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

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

/** Serializable management writes lock both customers first, then both users in ID order. */
export async function lockManagedAccount(tx: Prisma.TransactionClient, session: SessionPayload, userId: string, destination?: string) {
  const member = await tx.teamMember.findUnique({ where: { userId }, select: { teamId: true } });
  const teams = new Set([member?.teamId, destination].filter((id): id is string => !!id));
  for (const team of [...teams].sort()) {
    if (team === destination) await lockLiveCustomer(tx, team);
    else await tx.$queryRaw`SELECT id FROM teams WHERE id = ${team} FOR SHARE`;
  }
  for (const id of [...new Set([session.userId, userId])].sort()) {
    if (id === session.userId) await assertCurrentUserManager(tx, session);
    else await lockUserRow(tx, id);
  }
}
