import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
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

const patchSchema = z.union([
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("markAllAsRead") }),
    z.object({
      action: z.literal("markAsRead"),
      notificationId: z.string().min(1),
    }),
    z.object({ action: z.literal("delete"), notificationId: z.string().min(1) }),
  ]),
  // Legacy format support
  z.object({ markAllAsRead: z.literal(true) }),
  z.object({ notificationId: z.string().min(1) }),
]);

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "Failed to fetch notifications" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
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
      errorMessage: "Operation failed",
      bodySchema: patchSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      // Legacy format support
      if ("markAllAsRead" in body) {
        await markAllAsRead(session.userId);
        await auditUserAction(session?.userId ?? "", "notification.update", { scope: "markAllAsRead" }, undefined, session?.currentTeamId);
        return NextResponse.json({ success: true });
      }
      if (!("action" in body) && "notificationId" in body) {
        await markAsRead(body.notificationId, session.userId);
        return NextResponse.json({ success: true });
      }

      switch (body.action) {
        case "markAllAsRead":
          await markAllAsRead(session.userId);
          break;
        case "markAsRead":
          await markAsRead(body.notificationId, session.userId);
          break;
        case "delete":
          await deleteNotification(body.notificationId, session.userId);
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
      errorMessage: "Batch operation failed",
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

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

      // Partial batch outcomes are not overall success — callers must inspect counts.
      return NextResponse.json({
        success: failed === 0,
        marked: succeeded,
        failed,
        total: body.ids.length,
      }, { status: failed === 0 ? 200 : failed === body.ids.length ? 404 : 207 });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to delete notification",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const { id: notificationId } = parseSearchParams(request, idQuerySchema);
      await deleteNotification(notificationId, session.userId);
      await auditUserAction(session?.userId ?? "", "notification.delete", { notificationId }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true });
    },
  );
}
