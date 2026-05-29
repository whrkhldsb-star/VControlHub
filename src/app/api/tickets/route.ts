import { NextResponse } from "next/server";
import { z } from "zod";
import { addTicketComment, createTicket, listTickets, updateTicketStatus } from "@/lib/ticket/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const ticketCreateSchema = z.object({
  subject: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical", "normal", "urgent", "LOW", "MEDIUM", "HIGH", "CRITICAL", "NORMAL", "URGENT"]).optional(),
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
  priority: z.enum(["low", "medium", "high", "critical", "normal", "LOW", "MEDIUM", "HIGH", "CRITICAL", "NORMAL"]).optional(),
});

function normalizePriority(priority?: string) {
  if (!priority) return undefined;
  const upper = priority.toUpperCase();
  if (upper === "MEDIUM" || upper === "NORMAL") return "NORMAL";
  return upper;
}

function normalizeStatus(status: string) {
  return status.toUpperCase();
}
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage" }, async ({ session }) => {
    return NextResponse.json({ tickets: await listTickets(session?.userId) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const body = await request.json();
    if (body && typeof body === "object" && "ticketId" in body) {
      const parsed = ticketCommentSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
      return NextResponse.json({ comment: await addTicketComment({ ticketId: parsed.data.ticketId, authorId: session?.userId ?? "", body: parsed.data.body }) }, { status: 201 });
    }
    const parsed = ticketCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    return NextResponse.json({ ticket: await createTicket({ title: data.subject ?? data.title ?? "", description: data.description, priority: normalizePriority(data.priority), createdBy: session?.userId ?? "" }) }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const body = await request.json();
    const parsed = ticketPatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    return NextResponse.json({ ticket: await updateTicketStatus({ id: data.id, status: normalizeStatus(data.status), assigneeId: data.assigneeId }) });
  });
}
