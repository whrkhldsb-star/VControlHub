import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { canViewTicket, getTicketById, updateTicketStatus, addTicketComment } from "@/lib/ticket/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(_request, { requireAuth: true }, async ({ session }) => {
    const { id } = await params;
    if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(id, session.userId)))) {
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    }
    const ticket = await getTicketById(id);
    if (!ticket) return NextResponse.json({ error: "工单不存在" }, { status: 404 });
    return NextResponse.json({ ticket });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = { id };

    if (body.status) {
      const STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
      const status = String(body.status).toUpperCase();
      if (!STATUSES.has(status)) return NextResponse.json({ error: "无效状态" }, { status: 400 });
      updates.status = status;
    }
    if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;

    const ticket = await updateTicketStatus(updates as { id: string; status: string; assigneeId?: string | null });
    return NextResponse.json({ ticket });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const { id } = await params;
    if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(id, session.userId)))) {
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    }
    const body = await request.json();
    if (!body.body?.trim()) return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });
    const comment = await addTicketComment({ ticketId: id, authorId: session.userId, body: body.body.trim() });
    return NextResponse.json({ comment }, { status: 201 });
  });
}
