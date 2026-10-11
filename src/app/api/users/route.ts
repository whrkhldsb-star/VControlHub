import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { assertUserInActorScope, userDirectoryWhere } from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { paginationQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createUserSchema, updateUserSchema } from "@/lib/user/schema";
import { DEFAULT_IDENTITY_TEMPLATE_ID } from "@/lib/auth/identity-templates";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { z } from "zod";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "@/lib/user/admin-invariant";
export const dynamic = "force-dynamic";

// Shared page/pageSize shape; this directory historically defaulted to 50 per
// page with a 100 cap (not the schema's 20/200), so keep those exact values.
// `limit` is omitted — this route never accepted it, and keeping it would turn
// a previously-ignored `?limit=` into a 400.
const usersListQuerySchema = paginationQuerySchema
  .omit({ limit: true })
  .extend({
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  });

/** GET: administrators list every account; customer accounts their colleagues. */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:read" }, async ({ session }) => {
    const { page, pageSize } = parseSearchParams(request, usersListQuerySchema);
    const skip = (page - 1) * pageSize;
    const where = userDirectoryWhere(session);
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
        orderBy: { createdAt: "desc" },
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
      const user = await prisma.$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { username: body.username }, select: { id: true } })) {
          throw new ValidationError(t("backend.user.usernameAlreadyExists"));
        }
        if (account.type === "customer") {
          const [team, template] = await Promise.all([
            tx.team.findUnique({ where: { id: account.teamId }, select: { deletedAt: true } }),
            tx.identityTemplate.findUnique({ where: { id: identityTemplateId! }, select: { id: true } }),
          ]);
          if (!team || team.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));
          if (!template) throw new NotFoundError(t("backend.customer.templateNotFound"));
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

      await assertUserInActorScope(session, userId);

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!targetUser) {
        throw new NotFoundError(t("backend.user.notFound"));
      }

      if (userId === session.userId && userAction === "disable") {
        throw new ValidationError(t("backend.user.cannotDisableSelf"));
      }

      if (userAction === "disable") {
				await withAdminInvariantLock(async () => {
					await assertAdminAccessMayBeRemoved(userId);
					await prisma.user.update({
						where: { id: userId },
						data: { status: "DISABLED" },
					});
				});
        await auditUserAction(session.userId, "user.disable", {
          targetUsername: targetUser.username,
        }, undefined, session.currentTeamId);
      } else if (userAction === "enable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "ACTIVE" },
        });
        await auditUserAction(session.userId, "user.enable", {
          targetUsername: targetUser.username,
        }, undefined, session.currentTeamId);
      } else if (userAction === "reset_password") {
        // The schema refines reset_password ⇒ newPassword, but narrow it here too
        // so a future schema change cannot turn this into a silent no-op.
        if (!newPassword) {
          throw new ValidationError(t("backend.user.missingNewPassword"));
        }
        const resetPolicyError = await validatePasswordPolicy(newPassword);
        if (resetPolicyError) {
          throw new ValidationError(resetPolicyError);
        }
        const passwordHash = await hashPassword(newPassword);
        await prisma.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            mustChangePassword: true,
            status: "PENDING_PASSWORD_RESET",
          },
        });
        await auditUserAction(
          session.userId,
          "user.password_reset",
          { targetUsername: targetUser.username },
          "WARNING",
          session.currentTeamId,
        );
      } else {
        // `action` is optional in the schema (it also accepts newPassword only).
        // Without it nothing above runs, and returning success would tell the
        // caller a password reset happened when the account is untouched.
        throw new ValidationError(t("backend.user.missingAction"));
      }

      return NextResponse.json({ success: true });
    },
  );
}
