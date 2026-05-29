import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listUserNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification } from "@/lib/notification/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  ids: z.array(z.string()).min(1),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("markAllAsRead") }),
  z.object({ action: z.literal("markAsRead"), notificationId: z.string().min(1) }),
  z.object({ action: z.literal("delete"), notificationId: z.string().min(1) }),
]);

export async function GET() {
  try {
    const session = await requireSession();
    const [notifications, unreadCount] = await Promise.all([
      listUserNotifications(session.userId, { limit: 50 }),
      getUnreadCount(session.userId),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("认证") || msg.includes("session") || msg.includes("redirect")) {
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    }
    console.error("[Notifications] GET error:", error);
    return NextResponse.json({ error: "获取通知失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    const body = await request.json();

    // Legacy format support
    if (body.markAllAsRead) {
      await markAllAsRead(session.userId);
      return NextResponse.json({ success: true });
    }
    if (body.notificationId) {
      await markAsRead(body.notificationId, session.userId);
      return NextResponse.json({ success: true });
    }

    // New discriminated union format
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "无效请求", details: parsed.error.flatten() }, { status: 400 });
    }

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
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("认证") || msg.includes("session") || msg.includes("redirect")) {
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    }
    console.error("[Notifications] PATCH error:", error);
    return NextResponse.json({ error: "操作失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();

    if (!sessionHasPermission(session, "notification:manage")) {
      return NextResponse.json({ error: "权限不足" }, { status: 403 });
    }

    const rawBody = await request.json();
    const parsed = postSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "输入参数无效", details: parsed.error.flatten() }, { status: 400 });
    }

    // Batch mark multiple notifications as read
    const results = await Promise.allSettled(
      parsed.data.ids.map((id) => markAsRead(id, session.userId))
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({
      success: true,
      marked: succeeded,
      failed,
      total: parsed.data.ids.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("认证") || msg.includes("session") || msg.includes("redirect")) {
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    }
    console.error("[Notifications] POST error:", error);
    return NextResponse.json({ error: "批量操作失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const notificationId = searchParams.get("id");
    if (!notificationId) {
      return NextResponse.json({ error: "缺少通知 ID" }, { status: 400 });
    }
    await deleteNotification(notificationId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("认证") || msg.includes("session") || msg.includes("redirect")) {
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    }
    console.error("[Notifications] DELETE error:", error);
    return NextResponse.json({ error: "删除通知失败" }, { status: 500 });
  }
}
