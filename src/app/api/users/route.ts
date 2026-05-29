import { NextResponse } from "next/server";
import { z } from "zod";

import { hashPassword } from "@/lib/auth/password";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const postUserSchema = z.object({
  username: z.string().min(2, "用户名至少2个字符"),
  password: z.string().min(6, "密码至少6位"),
  roleKeys: z.array(z.string()).optional(),
  displayName: z.string().optional(),
});

const patchUserSchema = z
  .object({
    userId: z.string().min(1, "缺少用户ID"),
    action: z.enum(["disable", "enable", "reset_password"]).optional(),
    roleKeys: z.array(z.string()).optional(),
    newPassword: z.string().min(6, "新密码至少6位").optional(),
  })
  .refine(
    (data) =>
      data.action !== undefined ||
      data.roleKeys !== undefined ||
      data.newPassword !== undefined,
    {
      message: "至少提供一个更新字段",
      path: [],
    },
  );

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
      errorMessage: "创建用户失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });

      const body = await request.json().catch(() => null);
      const parsed = postUserSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      const { username, displayName, password, roleKeys } = parsed.data;

      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing) {
        return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          username,
          displayName: displayName || null,
          passwordHash,
          status: "ACTIVE",
          mustChangePassword: false,
        },
      });

      if (roleKeys && roleKeys.length > 0) {
        const roles = await prisma.role.findMany({
          where: { key: { in: roleKeys } },
        });
        for (const role of roles) {
          await prisma.userRole.create({
            data: { userId: user.id, roleId: role.id },
          });
        }
      } else {
        const viewerRole = await prisma.role.findUnique({
          where: { key: "viewer" },
        });
        if (viewerRole) {
          await prisma.userRole.create({
            data: { userId: user.id, roleId: viewerRole.id },
          });
        }
      }

      auditUserAction(session.userId, "user.create", {
        targetUsername: username,
        roles: roleKeys ?? [],
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
      errorMessage: "更新用户失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });

      const body = await request.json().catch(() => null);
      const parsed = patchUserSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      const { userId, action: userAction, roleKeys, newPassword } = parsed.data;

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!targetUser) {
        return NextResponse.json({ error: "用户不存在" }, { status: 404 });
      }

      if (userId === session.userId && userAction === "disable") {
        return NextResponse.json({ error: "不能禁用自己" }, { status: 400 });
      }

      if (userAction === "disable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "DISABLED" },
        });
        auditUserAction(session.userId, "user.disable", {
          targetUsername: targetUser.username,
        });
      } else if (userAction === "enable") {
        await prisma.user.update({
          where: { id: userId },
          data: { status: "ACTIVE" },
        });
        auditUserAction(session.userId, "user.enable", {
          targetUsername: targetUser.username,
        });
      } else if (userAction === "reset_password" && newPassword) {
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
          session.userId,
          "user.password_reset",
          { targetUsername: targetUser.username },
          "WARNING",
        );
      }

      if (roleKeys) {
        await prisma.userRole.deleteMany({ where: { userId } });
        const roles = await prisma.role.findMany({
          where: { key: { in: roleKeys } },
        });
        for (const role of roles) {
          await prisma.userRole.create({
            data: { userId, roleId: role.id },
          });
        }
        auditUserAction(session.userId, "user.role_update", {
          targetUsername: targetUser.username,
          roles: roleKeys,
        });
      }

      return NextResponse.json({ success: true });
    },
  );
}
