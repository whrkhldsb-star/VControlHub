import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError } from "@/lib/errors";
import {
  deleteNotification,
  getUnreadCount,
  listUserNotifications,
  markAllAsRead,
  markAsRead,
} from "@/lib/notification/service";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  ids: z.array(z.string()).min(1),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("markAllAsRead") }),
  z.object({
    action: z.literal("markAsRead"),
    notificationId: z.string().min(1),
  }),
  z.object({ action: z.literal("delete"), notificationId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "获取通知失败" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");
      const [notifications, unreadCount] = await Promise.all([
        listUserNotifications(session.userId, { limit: 50 }),
        getUnreadCount(session.userId),
      ]);
      return NextResponse.json({ notifications, unreadCount });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "操作失败",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");
      const body = await request.json().catch(() => null);

      // Legacy format support
      if (body?.markAllAsRead) {
        await markAllAsRead(session.userId);
        return NextResponse.json({ success: true });
      }
      if (body?.notificationId) {
        await markAsRead(body.notificationId, session.userId);
        return NextResponse.json({ success: true });
      }

      // New discriminated union format
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          { error: "无效请求", details: parsed.error.flatten() },
          { status: 400 },
        );

      switch (parsed.data.action) {
        case "markAllAsRead":
          await markAllAsRead(session.userId);
          break;
        case "markAsRead":
          await markAsRead(parsed.data.notificationId, session.userId);
          break;
        case "delete":
          await deleteNotification(parsed.data.notificationId, session.userId);
          break;
      }

      return NextResponse.json({ success: true });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "notification:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: postSchema,
      errorMessage: "批量操作失败",
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("未认证");

      // Batch mark multiple notifications as read
      const results = await Promise.allSettled(
        body.ids.map((id: string) => markAsRead(id, session.userId)),
      );
      const succeeded = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;

      return NextResponse.json({
        success: true,
        marked: succeeded,
        failed,
        total: body.ids.length,
      });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "删除通知失败",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");
      const { id: notificationId } = parseSearchParams(request, idQuerySchema);
      await deleteNotification(notificationId, session.userId);
      return NextResponse.json({ success: true });
    },
  );
}
