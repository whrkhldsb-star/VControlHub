/**
 * User preferences API — per-user settings stored in localStorage on client,
 * with optional server-side persistence via the User model.
 * GET  /api/preferences  — get current user preferences
 * PUT  /api/preferences  — update preferences
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const prefsSchema = z.object({
  sidebarCollapsed: z.boolean().optional(),
  defaultPage: z.string().optional(),
  dashboardWidgets: z.array(z.string()).optional(),
  notificationsEnabled: z.boolean().optional(),
  notificationSound: z.boolean().optional(),
  autoRefreshInterval: z.number().int().min(0).max(300).optional(),
  compactMode: z.boolean().optional(),
});

const defaultPreferences = {
  sidebarCollapsed: false,
  defaultPage: "/",
  dashboardWidgets: ["quick-links", "analytics", "audit-log"],
  notificationsEnabled: true,
  notificationSound: true,
  autoRefreshInterval: 0,
  compactMode: false,
};

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "获取偏好设置失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { preferences: true },
      });

      const prefs = user?.preferences
        ? {
            ...defaultPreferences,
            ...(typeof user.preferences === "object" ? user.preferences : {}),
          }
        : defaultPreferences;

      return NextResponse.json(prefs);
    },
  );
}

export async function PUT(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "保存偏好设置失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });

      const parsed = prefsSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });

      await prisma.user.update({
        where: { id: session.userId },
        data: { preferences: JSON.parse(JSON.stringify(parsed.data)) },
      });

      return NextResponse.json({ ok: true });
    },
  );
}
