import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { auditUserAction } from "@/lib/audit/service";
import {
  deleteNotification,
  getUnreadCount,
  listUserNotifications,
  markAllAsRead,
  markAsRead,
} from "@/lib/notification/service";

export const dynamic = "force-dynamic";

// limit/offset paging (not the shared page/pageSize shape): default 50 items,
// capped at 100; offset is non-negative. Same defaults the hand-rolled
// parseInt version used.
const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
    { requireAuth: true, errorMessage: apiCopy("apiCopy.failed.to.fetch.notifications.eb5f4282") },
    async ({ session }) => {
      const { limit, offset } = parseSearchParams(request, listNotificationsQuerySchema);
      const [notifications, unreadCount] = await Promise.all([
        listUserNotifications(session.userId, { limit, skip: offset }),
        getUnreadCount(session.userId),
      ]);
      return NextResponse.json({
        notifications,
        unreadCount,
        limit,
        offset,
        hasMore: notifications.length === limit,
      });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
      bodySchema: patchSchema,
    },
    async ({ session, body }) => {
      // Legacy format support
      if ("markAllAsRead" in body) {
        await markAllAsRead(session.userId);
        await auditUserAction(session.userId, "notification.update", { scope: "markAllAsRead" }, undefined, session.currentTeamId);
        return NextResponse.json({ success: true });
      }
      if (!("action" in body) && "notificationId" in body) {
        await markAsRead(body.notificationId, session.userId);
        return NextResponse.json({ success: true });
      }

      switch (body.action) {
        case "markAllAsRead":
          await markAllAsRead(session.userId);
          await auditUserAction(
            session.userId,
            "notification.update",
            { scope: "markAllAsRead" },
            undefined,
            session.currentTeamId,
          );
          break;
        case "markAsRead":
          await markAsRead(body.notificationId, session.userId);
          await auditUserAction(
            session.userId,
            "notification.update",
            { scope: "markAsRead", notificationId: body.notificationId },
            undefined,
            session.currentTeamId,
          );
          break;
        case "delete":
          await deleteNotification(body.notificationId, session.userId);
          await auditUserAction(
            session.userId,
            "notification.delete",
            { notificationId: body.notificationId },
            undefined,
            session.currentTeamId,
          );
          break;
      }

      return NextResponse.json({ success: true });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.delete.notification.9e1b8991"),
    },
    async ({ session }) => {
      const { id: notificationId } = parseSearchParams(request, idQuerySchema);
      await deleteNotification(notificationId, session.userId);
      await auditUserAction(session.userId, "notification.delete", { notificationId }, undefined, session.currentTeamId);
      return NextResponse.json({ success: true });
    },
  );
}
