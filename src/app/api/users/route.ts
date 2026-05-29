import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { auditUserAction } from "@/lib/audit/service";
import { createLogger } from "@/lib/logging";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const logger = createLogger("api:users");

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
    (data) => data.action !== undefined || data.roleKeys !== undefined || data.newPassword !== undefined,
    { message: "至少提供一个更新字段", path: [] },
  );

export const dynamic = "force-dynamic";

/** GET: List all users with their roles */
export async function GET() {
  try {
    const session = await requireSession();

    if (!sessionHasPermission(session, "user:read")) {
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    }

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

    const safeUsers = users.map((u) => ({
      ...u,
      roles: u.roles.map((r) => r.role),
    }));

    return NextResponse.json(safeUsers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST: Create a new user */
export async function POST(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  const session = await requireSession();

  if (!sessionHasPermission(session, "user:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = postUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "输入校验失败", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const { username, displayName, password, roleKeys } = parsed.data;

    // Check if username exists
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

    // Assign roles
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
      // Default: assign viewer role
      const viewerRole = await prisma.role.findUnique({ where: { key: "viewer" } });
      if (viewerRole) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId: viewerRole.id },
        });
      }
    }

    // Audit log
	auditUserAction(session.userId, "user.create", { targetUsername: username, roles: roleKeys ?? [] });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (error) {
    logger.error("create user failed", error);
    return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
  }
}

/** PATCH: Update user (status, roles, password reset) */
export async function PATCH(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  const session = await requireSession();

  if (!sessionHasPermission(session, "user:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = patchUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "输入校验失败", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const { userId, action: userAction, roleKeys, newPassword } = parsed.data;

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // Don't allow disabling yourself
    if (userId === session.userId && userAction === "disable") {
      return NextResponse.json({ error: "不能禁用自己" }, { status: 400 });
    }

    if (userAction === "disable") {
      await prisma.user.update({
        where: { id: userId },
        data: { status: "DISABLED" },
      });
      auditUserAction(session.userId, "user.disable", { targetUsername: targetUser.username });
    } else if (userAction === "enable") {
      await prisma.user.update({
        where: { id: userId },
        data: { status: "ACTIVE" },
      });
      auditUserAction(session.userId, "user.enable", { targetUsername: targetUser.username });
    } else if (userAction === "reset_password" && newPassword) {
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true, status: "PENDING_PASSWORD_RESET" },
      });
      auditUserAction(session.userId, "user.password_reset", { targetUsername: targetUser.username }, "WARNING");
    }

    // Update roles if provided
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
      auditUserAction(session.userId, "user.role_update", { targetUsername: targetUser.username, roles: roleKeys });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("update user failed", error);
    return NextResponse.json({ error: "更新用户失败" }, { status: 500 });
  }
}
