import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import {
  assertUserInActorScope,
  isGlobalTeamManager,
  userHoldsTeamManage,
  userDirectoryWhere,
} from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { paginationQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createUserSchema, updateUserSchema } from "@/lib/user/schema";

import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";
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

/** GET: List users visible in the actor's team scope */
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
        roles: {
          include: {
            role: { select: { key: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
    ]);

    const safeUsers = users.map((user) => ({
      ...user,
      roles: user.roles.map((role) => role.role),
    }));

    return NextResponse.json({ users: safeUsers, total: total ?? safeUsers.length, page, pageSize, totalPages: Math.ceil((total ?? safeUsers.length) / pageSize) });
  });
}

/** POST: Create a new user */
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
      if (passwordPolicyError) {
        throw new ValidationError(passwordPolicyError);
      }
      const username = body.username;
      const displayName = body.displayName ?? null;
      const requestedRoleKeys = Array.from(
        new Set((body.roleKeys ?? ["viewer"]).map((key) => key.trim()).filter(Boolean)),
      );
      const roleKeys = requestedRoleKeys.length > 0 ? requestedRoleKeys : ["viewer"];

      const user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { username } });
        if (existing) {
          throw new ValidationError(t("backend.user.usernameAlreadyExists"));
        }

        const roles = await tx.role.findMany({
          where: { key: { in: roleKeys } },
          select: {
            id: true,
            key: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
          take: roleKeys.length,
        });
        const foundRoleKeys = new Set(roles.map((role) => role.key));
        const missingRoleKeys = roleKeys.filter((key) => !foundRoleKeys.has(key));
        if (missingRoleKeys.length > 0) {
          throw new ValidationError(t("backend.user.roleNotFound", { roles: missingRoleKeys.join(", ") }));
        }
		if (!isGlobalTeamManager(session)) {
			if (roles.some((role) => role.key === "admin")) {
				throw new ForbiddenError(t("backend.user.cannotGrantAdminRole"));
			}
			const actorPermissions = new Set<string>(session.permissions ?? []);
			const beyondActor = roles.filter((role) =>
				role.permissions.some((grant) => !actorPermissions.has(grant.permission.key)),
			);
			if (beyondActor.length > 0) {
				throw new ForbiddenError(t("backend.user.cannotGrantBeyondOwnPermissions", {
					roles: beyondActor.map((role) => role.key).join(", "),
				}));
			}
		}

        const passwordHash = await hashPassword(body.password);
        const createdUser = await tx.user.create({
          data: {
            username,
            displayName,
            passwordHash,
            status: "ACTIVE",
            // Admin-provisioned accounts must set their own password on first login.
            mustChangePassword: true,
          },
        });

        if (roles.length > 0) {
          await tx.userRole.createMany({
            data: roles.map((role) => ({ userId: createdUser.id, roleId: role.id })),
            skipDuplicates: true,
          });
        }

        // Non-global managers create users into the current team workspace.
        if (session.currentTeamId) {
          await tx.teamMember.upsert({
            where: {
              teamId_userId: {
                teamId: session.currentTeamId,
                userId: createdUser.id,
              },
            },
            update: {},
            create: {
              teamId: session.currentTeamId,
              userId: createdUser.id,
              role: "member",
            },
          });
        }

        return createdUser;
      });

      await auditUserAction(session.userId, "user.create", {
        targetUsername: username,
        roles: roleKeys,
        teamId: session.currentTeamId ?? null,
      }, undefined, session.currentTeamId);

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
      const { userId, action: userAction, roleKeys, newPassword } = body;
			if (roleKeys !== undefined) {
				throw new ValidationError(t("backend.user.rolesMustUsePermissionsEndpoint"));
			}

      await assertUserInActorScope(session, userId);

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!targetUser) {
        throw new NotFoundError(t("backend.user.notFound"));
      }

      // Credential/status changes on a platform administrator are reserved for
      // global team managers. A delegated team `user:manage` who pulled the
      // admin into their workspace must not be able to reset the admin's
      // password (account takeover) or disable them (platform lockout).
      if (
        (userAction === "reset_password" || userAction === "disable") &&
        !isGlobalTeamManager(session)
      ) {
        const targetIsPlatformAdmin = await userHoldsTeamManage(userId);
        if (targetIsPlatformAdmin) {
          throw new ForbiddenError(t("backend.user.cannotModifyPlatformAdmin"));
        }
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
        // `action` is optional in the schema (it also accepts roleKeys/newPassword
        // only). Without it nothing above runs, and returning success would tell
        // the caller a password reset happened when the account is untouched.
        throw new ValidationError(t("backend.user.missingAction"));
      }

      return NextResponse.json({ success: true });
    },
  );
}
