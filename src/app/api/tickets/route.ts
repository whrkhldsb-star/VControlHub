import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { addTicketComment, canViewTicket, createTicket, listTickets, updateTicketStatus } from "@/lib/ticket/service";
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
    return NextResponse.json({
      tickets: await listTickets({
        userId: session?.userId,
        includeAll: Boolean(session && sessionHasPermission(session, "ticket:manage")),
      }),
    });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: ticketPostSchema }, async ({ session, body }) => {
    if ("ticketId" in body) {
      if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(body.ticketId, session.userId)))) {
        throw new ForbiddenError("MissingPermission");
      }
      return NextResponse.json({ comment: await addTicketComment({ ticketId: body.ticketId, authorId: session?.userId ?? "", body: body.body }) }, { status: 201 });
    }
    if (!session || !sessionHasPermission(session, "ticket:create")) {
      throw new ForbiddenError("MissingPermission");
    }
    return NextResponse.json({ ticket: await createTicket({ title: body.subject ?? body.title ?? "", description: body.description, priority: normalizePriority(body.priority), createdBy: session?.userId ?? "" }) }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: ticketPatchSchema }, async ({ body }) => {
    return NextResponse.json({ ticket: await updateTicketStatus({ id: body.id, status: normalizeStatus(body.status), assigneeId: body.assigneeId, priority: normalizePriority(body.priority) }) });
  });
}
