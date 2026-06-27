import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createUserSchema, updateUserSchema } from "@/lib/user/schema";

import { NotFoundError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

/** GET: List all users with their roles */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:read" }, async () => {
    const users = await prisma.user.findMany({
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
      take: 500,
    });

    const safeUsers = users.map((user) => ({
      ...user,
      roles: user.roles.map((role) => role.role),
    }));

    return NextResponse.json(safeUsers);
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
      errorMessage: "创建用户失败",
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
          throw new Error("用户名已存在");
        }

        const roles = await tx.role.findMany({
          where: { key: { in: roleKeys } },
          take: roleKeys.length,
        });
        const foundRoleKeys = new Set(roles.map((role) => role.key));
        const missingRoleKeys = roleKeys.filter((key) => !foundRoleKeys.has(key));
        if (missingRoleKeys.length > 0) {
          throw new Error(`角色不存在: ${missingRoleKeys.join(", ")}`);
        }

        const passwordHash = await hashPassword(body.password);
        const createdUser = await tx.user.create({
          data: {
            username,
            displayName,
            passwordHash,
            status: "ACTIVE",
            mustChangePassword: false,
          },
        });

        if (roles.length > 0) {
          await tx.userRole.createMany({
            data: roles.map((role) => ({ userId: createdUser.id, roleId: role.id })),
            skipDuplicates: true,
          });
        }

        return createdUser;
      });

      auditUserAction(session!.userId, "user.create", {
        targetUsername: username,
        roles: roleKeys,
      });

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
      errorMessage: "更新用户失败",
    },
    async ({ session, body }) => {
      const { userId, action: userAction, roleKeys, newPassword } = body;

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!targetUser) {
        throw new NotFoundError("用户不存在");
      }

      if (userId === session!.userId && userAction === "disable") {
        throw new ValidationError("不能禁用自己");
      }

      if (userAction === "disable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "DISABLED" },
        });
        auditUserAction(session!.userId, "user.disable", {
          targetUsername: targetUser.username,
        });
      } else if (userAction === "enable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "ACTIVE" },
        });
        auditUserAction(session!.userId, "user.enable", {
          targetUsername: targetUser.username,
        });
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
        auditUserAction(
          session!.userId,
          "user.password_reset",
          { targetUsername: targetUser.username },
          "WARNING",
        );
      }

      if (roleKeys) {
        await prisma.userRole.deleteMany({ where: { userId } });
        const roles = await prisma.role.findMany({
          where: { key: { in: roleKeys } },
          take: roleKeys.length,
        });
        await prisma.userRole.createMany({
          data: roles.map((role) => ({ userId, roleId: role.id })),
          skipDuplicates: true,
        });
        auditUserAction(session!.userId, "user.role_update", {
          targetUsername: targetUser.username,
          roles: roleKeys,
        });
      }

      return NextResponse.json({ success: true });
    },
  );
}
