import { apiCopy } from "@/lib/i18n/api-copy";
import type { Prisma } from "@prisma/client";
import { assertCurrentUserManager, lockManagedAccount } from "@/lib/user/row-lock";
import { resolveCustomerMembershipTarget } from "@/lib/team/service";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { assertUserInActorScope, userDirectoryWhere } from "@/lib/auth/team-scope";
import { auditUserAction, writeAuditLog } from "@/lib/audit/service";
import { isUniqueViolation, prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { withApiRoute } from "@/lib/http/api-guard";
import { booleanFlagSchema, paginationOffset, paginationQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createUserSchema, updateUserSchema } from "@/lib/user/schema";
import { DEFAULT_IDENTITY_TEMPLATE_ID } from "@/lib/auth/identity-templates";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { z } from "zod";
import { assertAdminAccessMayBeRemoved, withAccountTransaction, withAdminInvariantLock } from "@/lib/user/admin-invariant";
export const dynamic = "force-dynamic";

// Shared page/pageSize shape; this directory historically defaulted to 50 per
// page with a 100 cap (not the schema's 20/200), so keep those exact values.
// `limit` is omitted — this route never accepted it, and keeping it would turn
// a previously-ignored `?limit=` into a 400.
const usersListQuerySchema = paginationQuerySchema
  .omit({ limit: true })
  .extend({
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    /** Only customer accounts that belong to no customer yet (the member picker). */
    unassigned: booleanFlagSchema.optional(),
    /** Part of a username or display name (the directory's search box); `%` and `_` are matched as typed. */
    q: z.string().trim().max(100).optional(),
  });

/** GET: administrators list every account; customer accounts their colleagues. */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:read" }, async ({ session }) => {
    const { page, pageSize, unassigned, q } = parseSearchParams(request, usersListQuerySchema);
    const skip = paginationOffset(page, pageSize);
    // The member picker used to page through the whole directory (up to 5000
    // accounts) to find the unassigned ones (A1-04); filter server-side.
    // Every filter narrows the directory the session may read; it never widens it.
    const filters: Record<string, unknown>[] = [userDirectoryWhere(session)];
    if (unassigned === true) filters.push({ teamMembership: null, roles: { none: { role: { key: "admin" } } } });
    if (q) {
      const contains = { contains: escapeLikeLiteral(q), mode: "insensitive" as const };
      filters.push({ OR: [{ username: contains }, { displayName: contains }] });
    }
    const where = filters.length === 1 ? filters[0]! : { AND: filters };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          status: true,
          mustChangePassword: true,
          createdAt: true,
          updatedAt: true,
          roles: { select: { role: { select: { key: true } } } },
          teamMembership: {
            select: {
              team: { select: { id: true, name: true, deletedAt: true } },
              identityTemplate: { select: { id: true, name: true, isBuiltin: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    const safeUsers = users.map(({ roles, teamMembership, ...user }) => ({
      ...user,
      accountType: roles.some((entry) => entry.role.key === "admin") ? "admin" as const : "customer" as const,
      customer: teamMembership ? { id: teamMembership.team.id, name: teamMembership.team.name, deleted: Boolean(teamMembership.team.deletedAt) } : null,
      identityTemplate: teamMembership?.identityTemplate ?? null,
    }));

    return NextResponse.json({ users: safeUsers, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });
}

/** POST: create a platform administrator or a customer account. */
export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: createUserSchema,
      errorStatus: 400,
      errorMessage: apiCopy("apiCopy.failed.to.create.user.2426e88a"),
    },
    async ({ session, body }) => {
      const passwordPolicyError = await validatePasswordPolicy(body.password);
      if (passwordPolicyError) throw new ValidationError(passwordPolicyError);
      const { account } = body;
      const identityTemplateId = account.type === "customer" ? account.identityTemplateId || DEFAULT_IDENTITY_TEMPLATE_ID : null;

      // Hash before the transaction: scrypt is slow and must not hold a connection.
      const passwordHash = await hashPassword(body.password);
      // Check-then-create races with a concurrent creation of the same name: the
      // unique index decides, and that must read as 400, not 500 (A1-07).
      const user = await withAccountTransaction(async (tx) => {
        if (account.type === "customer") await resolveCustomerMembershipTarget(account.teamId, identityTemplateId, tx);
        await assertCurrentUserManager(tx, session);
        if (await tx.user.findUnique({ where: { username: body.username }, select: { id: true } })) {
          throw new ValidationError(t("backend.user.usernameAlreadyExists"));
        }
        const adminRole = account.type === "admin"
          ? await tx.role.findUnique({ where: { key: "admin" }, select: { id: true } })
          : null;
        if (account.type === "admin" && !adminRole) throw new ValidationError(t("backend.user.roleNotFound", { roles: "admin" }));

        return tx.user.create({
          data: {
            username: body.username,
            displayName: body.displayName ?? null,
            passwordHash,
            status: "ACTIVE",
            // Accounts provisioned by an administrator set their own password on first login.
            mustChangePassword: true,
            ...(adminRole ? { roles: { create: { roleId: adminRole.id } } } : {}),
            ...(account.type === "customer"
              ? {
                  currentTeamId: account.teamId,
                  teamMembership: { create: { teamId: account.teamId, identityTemplateId: identityTemplateId! } },
                }
              : {}),
          },
          select: { id: true },
        });
      }).then((row) => row, (error: unknown) => {
        if (isUniqueViolation(error)) throw new ValidationError(t("backend.user.usernameAlreadyExists"));
        throw error;
      });

      await auditUserAction(session.userId, "user.create", {
        targetUsername: body.username,
        accountType: account.type,
        teamId: account.type === "customer" ? account.teamId : null,
        identityTemplateId,
      }, undefined, account.type === "customer" ? account.teamId : null);

      return NextResponse.json({ success: true, userId: user.id });
    },
  );
}

/** PATCH: Update user (status, roles, password reset) */
export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: updateUserSchema,
      errorMessage: apiCopy("apiCopy.failed.to.update.user.237db3c5"),
    },
    async ({ session, body }) => {
      const { userId, action: userAction, newPassword } = body;

      if (!userAction) throw new ValidationError(t("backend.user.missingAction"));
      if (userId === session.userId && userAction === "disable") {
        throw new ValidationError(t("backend.user.cannotDisableSelf"));
      }
      let data: Prisma.UserUpdateInput;
      if (userAction === "reset_password") {
        if (!newPassword) throw new ValidationError(t("backend.user.missingNewPassword"));
        const policyError = await validatePasswordPolicy(newPassword);
        if (policyError) throw new ValidationError(policyError);
        data = { passwordHash: await hashPassword(newPassword), mustChangePassword: true, sessionEpoch: { increment: 1 } };
      } else {
        data = userAction === "disable" ? { status: "DISABLED", sessionEpoch: { increment: 1 } } : { status: "ACTIVE" };
      }

      const update = async (tx: Prisma.TransactionClient) => {
        await lockManagedAccount(tx, session, userId);
        await assertUserInActorScope(session, userId, tx);
        const target = await tx.user.findUnique({
          where: { id: userId }, select: { username: true, teamMembership: { select: { teamId: true } } },
        });
        if (!target) throw new NotFoundError(t("backend.user.notFound"));
        const teamId = target.teamMembership?.teamId ?? null;
        if (userAction === "disable") await assertAdminAccessMayBeRemoved(userId, tx);
        await tx.user.update({ where: { id: userId }, data });
        await writeAuditLog({
          actorType: "USER", actorId: session.userId, teamId,
          action: userAction === "reset_password" ? "user.password_reset" : userAction === "disable" ? "user.disable" : "user.enable",
          severity: userAction === "reset_password" ? "WARNING" : "INFO",
          detail: { targetUsername: target.username },
        }, tx);
      };
      if (userAction === "disable") await withAdminInvariantLock(update);
      else await withAccountTransaction(update);

      return NextResponse.json({ success: true });
    },
  );
}
