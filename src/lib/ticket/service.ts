import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";

const STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export async function createTicket(input: { title: string; description: string; priority?: string; createdBy: string }) {
  if (!input.title.trim() || !input.description.trim()) throw new ValidationError("工单标题和描述不能为空");
  return prisma.ticket.create({ data: { title: input.title.trim(), description: input.description.trim(), status: "OPEN", priority: input.priority ?? "NORMAL", createdBy: input.createdBy } });
}

export async function listTickets(input?: { userId?: string; includeAll?: boolean } | string) {
  const userId = typeof input === "string" ? input : input?.userId;
  const includeAll = typeof input === "object" ? input.includeAll === true : false;
  return prisma.ticket.findMany({
    where: !includeAll && userId ? { OR: [{ createdBy: userId }, { assigneeId: userId }] } : {},
    include: {
      creator: { select: { username: true, displayName: true } },
      assignee: { select: { username: true, displayName: true } },
      comments: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function getTicketById(id: string) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, username: true, displayName: true } },
      assignee: { select: { id: true, username: true, displayName: true } },
      comments: { include: { author: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
}

export async function canViewTicket(id: string, userId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { createdBy: true, assigneeId: true },
  });
  return ticket?.createdBy === userId || ticket?.assigneeId === userId;
}

export async function updateTicketStatus(input: { id: string; status?: string; assigneeId?: string | null; priority?: string }) {
  const data: { status?: string; assigneeId?: string | null; closedAt?: Date | null; priority?: string } = {};

  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new ValidationError("工单状态无效");
    data.status = input.status;
    data.closedAt = input.status === "CLOSED" ? new Date() : null;
  }

  if (input.assigneeId !== undefined) {
    data.assigneeId = input.assigneeId;
  }

  if (input.priority !== undefined) {
    data.priority = input.priority;
  }

  if (Object.keys(data).length === 0) throw new ValidationError("工单更新内容不能为空");

  return prisma.ticket.update({ where: { id: input.id }, data });
}

export async function addTicketComment(input: { ticketId: string; authorId: string; body: string }) {
  if (!input.body.trim()) throw new ValidationError("回复内容不能为空");
  return prisma.ticketComment.create({
    data: { ticketId: input.ticketId, authorId: input.authorId, body: input.body.trim() },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
}
