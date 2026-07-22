import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import {
  assertUserInActorScope,
  userDirectoryWhere,
} from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createUserSchema, updateUserSchema } from "@/lib/user/schema";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
export const dynamic = "force-dynamic";

/** GET: List users visible in the actor's team scope */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:read" }, async ({ session }) => {
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
    const skip = (page - 1) * pageSize;
    const where = userDirectoryWhere(session!);
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
      errorMessage: "Failed to create user",
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
          take: roleKeys.length,
        });
        const foundRoleKeys = new Set(roles.map((role) => role.key));
        const missingRoleKeys = roleKeys.filter((key) => !foundRoleKeys.has(key));
        if (missingRoleKeys.length > 0) {
          throw new ValidationError(t("backend.user.roleNotFound").replace("{roles}", missingRoleKeys.join(", ")));
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
        if (session?.currentTeamId) {
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

      await auditUserAction(session!.userId, "user.create", {
        targetUsername: username,
        roles: roleKeys,
        teamId: session?.currentTeamId ?? null,
      }, undefined, session?.currentTeamId);

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
      errorMessage: "Failed to update user",
    },
    async ({ session, body }) => {
      const { userId, action: userAction, roleKeys, newPassword } = body;

      await assertUserInActorScope(session!, userId);

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!targetUser) {
        throw new NotFoundError(t("backend.user.notFound"));
      }

      if (userId === session!.userId && userAction === "disable") {
        throw new ValidationError(t("backend.user.cannotDisableSelf"));
      }

      if (userAction === "disable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "DISABLED" },
        });
        await auditUserAction(session!.userId, "user.disable", {
          targetUsername: targetUser.username,
        }, undefined, session?.currentTeamId);
      } else if (userAction === "enable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "ACTIVE" },
        });
        await auditUserAction(session!.userId, "user.enable", {
          targetUsername: targetUser.username,
        }, undefined, session?.currentTeamId);
      } else if (userAction === "reset_password" && newPassword) {
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
          session!.userId,
          "user.password_reset",
          { targetUsername: targetUser.username },
          "WARNING",
          session?.currentTeamId,
        );
      }

      if (roleKeys) {
        await prisma.$transaction(async (tx) => {
          await tx.userRole.deleteMany({ where: { userId } });
          const roles = await tx.role.findMany({
            where: { key: { in: roleKeys } },
            take: roleKeys.length,
          });
          if (roles.length > 0) {
            await tx.userRole.createMany({
              data: roles.map((role) => ({ userId, roleId: role.id })),
              skipDuplicates: true,
            });
          }
        });
        await auditUserAction(session!.userId, "user.role_update", {
          targetUsername: targetUser.username,
          roles: roleKeys,
        }, undefined, session?.currentTeamId);
      }

      return NextResponse.json({ success: true });
    },
  );
}
