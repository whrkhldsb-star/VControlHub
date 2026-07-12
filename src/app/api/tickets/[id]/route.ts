import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { canViewTicket, getTicketById, updateTicketStatus, addTicketComment } from "@/lib/ticket/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

/**
 * TR-037: declarative zod request validation. Replaces the previous
 * inline `await request.json()` + manual `if`/`set.has` checks. Failed
 * parses now flow through the unified TR-034 ValidationError envelope
 * (HTTP 400 + { code: "VALIDATION_FAILED", message, error }) instead of
 * each route inventing its own ad-hoc shapes.
 */
const TicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

const PatchBodySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    // assigneeId may be set to null to unassign — keep nullable.
    assigneeId: z.string().nullable().optional(),
  })
  .strict();

const CommentBodySchema = z
  .object({
    body: z.string().trim().min(1, "Reply content is required"),
  })
  .strict();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(_request, { requireAuth: true }, async ({ session }) => {
    const { id } = await params;
    if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(id, session.userId)))) {
      throw new ForbiddenError("Missing permission");
    }
    const ticket = await getTicketById(id);
    if (!ticket) throw new NotFoundError("Ticket not found");
    return NextResponse.json({ ticket });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: PatchBodySchema },
    async ({ body, session }) => {
      const { id } = await params;
      const updates: { id: string; status?: string; assigneeId?: string | null } = { id };
      if (body.status) updates.status = body.status;
      if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
      const ticket = await updateTicketStatus(updates);
      await auditUserAction(session?.userId ?? "", "ticket.update", { ticketId: id });
      return NextResponse.json({ ticket });
    },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    { requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: CommentBodySchema },
    async ({ session, body }) => {
      const { id } = await params;
      if (!session || (!sessionHasPermission(session, "ticket:manage") && !(await canViewTicket(id, session.userId)))) {
        throw new ForbiddenError("Missing permission");
      }
      const comment = await addTicketComment({ ticketId: id, authorId: session.userId, body: body.body });
      await auditUserAction(session?.userId ?? "", "ticket.comment", { ticketId: id });
      return NextResponse.json({ comment }, { status: 201 });
    },
  );
}
