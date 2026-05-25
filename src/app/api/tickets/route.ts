import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { addTicketComment, createTicket, listTickets, updateTicketStatus } from "@/lib/ticket/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const ticketCreateSchema = z.object({
  subject: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  category: z.string().optional(),
  serverId: z.string().optional(),
}).refine((data) => Boolean(data.subject || data.title), {
  message: "工单标题不能为空",
  path: ["subject"],
});

const ticketCommentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().min(1),
});

const ticketPatchSchema = z.object({
 id: z.string().min(1),
 status: z.enum(["open", "in_progress", "resolved", "closed", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
 assigneeId: z.string().optional(),
 priority: z.enum(["low", "medium", "high", "critical", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

function normalizePriority(priority?: string) {
  if (!priority) return undefined;
  if (priority.toUpperCase() === "MEDIUM") return "NORMAL";
  return priority.toUpperCase();
}

function normalizeStatus(status: string) {
  return status.toUpperCase();
}

export const dynamic = "force-dynamic";
export async function GET(_request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "ticket:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
		return NextResponse.json({ tickets: await listTickets(session.userId) });
	} catch (error) {
		const message = error instanceof Error ? error.message : "操作失败";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
export async function POST(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "ticket:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
		const body = await request.json();
		if (body && typeof body === "object" && "ticketId" in body) {
			const parsed = ticketCommentSchema.safeParse(body);
			if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
			return NextResponse.json({ comment: await addTicketComment({ ticketId: parsed.data.ticketId, authorId: session.userId, body: parsed.data.body }) }, { status: 201 });
		}
		const parsed = ticketCreateSchema.safeParse(body);
		if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
		const data = parsed.data;
		return NextResponse.json({ ticket: await createTicket({ title: data.subject ?? data.title ?? "", description: data.description, priority: normalizePriority(data.priority), createdBy: session.userId }) }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "操作失败";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
export async function PATCH(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "ticket:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
		const body = await request.json();
		const parsed = ticketPatchSchema.safeParse(body);
		if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
		const data = parsed.data;
		return NextResponse.json({ ticket: await updateTicketStatus({ id: data.id, status: normalizeStatus(data.status), assigneeId: data.assigneeId }) });
	} catch (error) {
		const message = error instanceof Error ? error.message : "操作失败";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
