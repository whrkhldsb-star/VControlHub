import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { addTicketComment, canViewTicket, createTicket, listTickets, updateTicketStatus } from "@/lib/ticket/service";
import { listTicketsAdvanced, getTicketKanban } from "@/lib/ticket/sla";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ForbiddenError } from "@/lib/errors";
const ticketCreateSchema = z.object({
  subject: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical", "normal", "urgent", "LOW", "MEDIUM", "HIGH", "CRITICAL", "NORMAL", "URGENT"]).optional(),
  category: z.string().optional(),
  serverId: z.string().optional(),
  relatedServerId: z.string().optional(),
  relatedCommandId: z.string().optional(),
}).refine((data) => Boolean(data.subject || data.title), {
  message: "Ticket title is required",
  path: ["subject"],
});

const ticketCommentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().min(1),
});

const ticketPostSchema = z.union([ticketCommentSchema, ticketCreateSchema]);

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
  return withApiRoute(request, { permission: "ticket:read" }, async ({ session }) => {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const status = url.searchParams.get("status") ?? undefined;
    const priority = url.searchParams.get("priority") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const assigneeId = url.searchParams.get("assigneeId") ?? undefined;
    const slaStatus = url.searchParams.get("slaStatus") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;

    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // FEAT-P1-1: Kanban view
    if (view === "kanban") {
      const columns = await getTicketKanban({ session });
      return NextResponse.json({ columns });
    }

    // FEAT-P1-1: Advanced filtered list
    const hasFilters = status || priority || category || assigneeId || slaStatus || search;
    if (hasFilters) {
      const tickets = await listTicketsAdvanced({
        session,
        status: status?.toUpperCase(),
        priority: priority?.toUpperCase(),
        category,
        assigneeId,
        slaStatus: slaStatus as "ok" | "warning" | "breached" | "none" | undefined,
        search,
      });
      return NextResponse.json({ tickets });
    }

    // Default: backward-compatible list
    return NextResponse.json({
      tickets: await listTickets({
        userId: session?.userId,
        includeAll: Boolean(session && sessionHasPermission(session, "ticket:manage")),
        session: session ?? undefined,
      }),
    });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: ticketPostSchema }, async ({ session, body }) => {
    if ("ticketId" in body) {
      if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(body.ticketId, session.userId)))) {
        throw new ForbiddenError("Missing permission");
      }
      const comment = await addTicketComment({ ticketId: body.ticketId, authorId: session?.userId ?? "", body: body.body });
      await auditUserAction(session?.userId ?? "", "ticket.comment", { ticketId: body.ticketId, commentId: comment.id });
      return NextResponse.json({ comment }, { status: 201 });
    }
    if (!session || !sessionHasPermission(session, "ticket:create")) {
      throw new ForbiddenError("Missing permission");
    }
    const ticket = await createTicket({
      title: body.subject ?? body.title ?? "",
      description: body.description,
      priority: normalizePriority(body.priority),
      category: body.category,
      createdBy: session?.userId ?? "",
      relatedServerId: body.relatedServerId,
      relatedCommandId: body.relatedCommandId,
      session,
    });
    await auditUserAction(session?.userId ?? "", "ticket.create", { ticketId: ticket.id, title: ticket.title });
    return NextResponse.json({ ticket }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: ticketPatchSchema }, async ({ session, body }) => {
    const ticket = await updateTicketStatus({ id: body.id, status: normalizeStatus(body.status), assigneeId: body.assigneeId, priority: normalizePriority(body.priority) });
    await auditUserAction(session?.userId ?? "", "ticket.update", { ticketId: body.id, status: body.status });
    return NextResponse.json({ ticket });
  });
}
