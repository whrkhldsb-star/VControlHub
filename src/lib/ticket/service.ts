import { prisma } from "@/lib/db";

const STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

export async function createTicket(input: { title: string; description: string; priority?: string; createdBy: string }) {
  if (!input.title.trim() || !input.description.trim()) throw new Error("工单标题和描述不能为空");
  return prisma.ticket.create({ data: { title: input.title.trim(), description: input.description.trim(), status: "OPEN", priority: input.priority ?? "NORMAL", createdBy: input.createdBy } });
}

export async function listTickets(userId?: string) {
  return prisma.ticket.findMany({ where: userId ? { OR: [{ createdBy: userId }, { assigneeId: userId }] } : {}, include: { creator: { select: { username: true, displayName: true } }, assignee: { select: { username: true, displayName: true } }, comments: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" } });
}

export async function updateTicketStatus(input: { id: string; status: string; assigneeId?: string | null }) {
  if (!STATUSES.has(input.status)) throw new Error("工单状态无效");
  return prisma.ticket.update({ where: { id: input.id }, data: { status: input.status, assigneeId: input.assigneeId, closedAt: input.status === "CLOSED" ? new Date() : null } });
}

export async function addTicketComment(input: { ticketId: string; authorId: string; body: string }) {
  if (!input.body.trim()) throw new Error("回复内容不能为空");
  return prisma.ticketComment.create({ data: { ticketId: input.ticketId, authorId: input.authorId, body: input.body.trim() } });
}
