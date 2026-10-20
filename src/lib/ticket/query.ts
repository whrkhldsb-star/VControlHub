/**
 * The ticket workspace's filtered, paged reads. Every filter is part of the
 * query and every page comes with the total it belongs to: filtering a loaded
 * window in the browser (open work up to 1000, finished up to 200) hid
 * matching tickets beyond it while the counts above still included them.
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ticketListWhere, type TicketListInput } from "./service";

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketSlaFilter = "ok" | "warning" | "breached" | "none";

export type TicketQuery = {
  status?: string;
  priority?: string;
  category?: string;
  assigneeId?: string;
  slaStatus?: TicketSlaFilter;
  search?: string;
};

/** Below this much time left an open ticket's SLA is a warning. */
export const SLA_WARNING_MS = 60 * 60 * 1000;
export const TICKET_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
/** Cards per board column; each column reports its full total. */
export const TICKET_BOARD_COLUMN_LIMIT = 100;

const ACTIVE = { status: { in: ["OPEN", "IN_PROGRESS"] } } satisfies Prisma.TicketWhereInput;

/** The query's filters as conditions; SLA states are judged at `now`. */
export function ticketQueryClauses(query: TicketQuery, now: Date): Prisma.TicketWhereInput[] {
  const clauses: Prisma.TicketWhereInput[] = [];
  if (query.status) clauses.push({ status: query.status });
  if (query.priority) clauses.push({ priority: query.priority });
  if (query.category) clauses.push({ category: query.category });
  if (query.assigneeId) clauses.push({ assigneeId: query.assigneeId });
  const search = query.search?.trim();
  if (search) {
    clauses.push({ OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] });
  }
  const warnUntil = new Date(now.getTime() + SLA_WARNING_MS);
  if (query.slaStatus === "none") clauses.push({ OR: [{ slaDueAt: null }, { status: { in: ["RESOLVED", "CLOSED"] } }] });
  if (query.slaStatus === "breached") clauses.push({ slaDueAt: { lt: now }, ...ACTIVE });
  if (query.slaStatus === "warning") clauses.push({ slaDueAt: { gte: now, lt: warnUntil }, ...ACTIVE });
  if (query.slaStatus === "ok") clauses.push({ slaDueAt: { gte: warnUntil }, ...ACTIVE });
  return clauses;
}

const TICKET_ROW_INCLUDE = {
  creator: { select: { username: true, displayName: true } },
  assignee: { select: { username: true, displayName: true } },
} satisfies Prisma.TicketInclude;

const ORDER = [{ updatedAt: "desc" }, { id: "desc" }] satisfies Prisma.TicketOrderByWithRelationInput[];

function scopedWhere(input: TicketListInput, query: TicketQuery, now: Date, extra: Prisma.TicketWhereInput[] = []): Prisma.TicketWhereInput {
  return { AND: [ticketListWhere(input), ...ticketQueryClauses(query, now), ...extra] };
}

/** One page of the filtered list and the number of tickets matching in all. */
export async function listTicketPage(input: TicketListInput & {
  query?: TicketQuery;
  page?: number;
  pageSize?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? TICKET_PAGE_SIZE)));
  const where = scopedWhere(input, input.query ?? {}, now);
  const total = await prisma.ticket.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // A page past the end (the list shrank since the link was made) shows the last one.
  const page = Math.min(pages, Math.max(1, Math.floor(input.page ?? 1)));
  const tickets = await prisma.ticket.findMany({
    where,
    include: TICKET_ROW_INCLUDE,
    orderBy: ORDER,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { tickets, total, page, pageSize };
}

/** The board: each status column filtered on its own, with its full total. */
export async function listTicketBoard(input: TicketListInput & {
  query?: TicketQuery;
  perColumn?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const take = Math.min(TICKET_BOARD_COLUMN_LIMIT, Math.max(1, Math.floor(input.perColumn ?? TICKET_BOARD_COLUMN_LIMIT)));
  const query = input.query ?? {};
  const columns = await Promise.all(TICKET_STATUSES.map(async (status) => {
    // A status filter leaves the other columns empty instead of mislabelled.
    if (query.status && query.status !== status) return [status, { tickets: [], total: 0 }] as const;
    const where = scopedWhere(input, { ...query, status: undefined }, now, [{ status }]);
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({ where, include: TICKET_ROW_INCLUDE, orderBy: ORDER, take }),
    ]);
    return [status, { tickets, total }] as const;
  }));
  return Object.fromEntries(columns) as Record<TicketStatus, { tickets: Awaited<ReturnType<typeof listTicketPage>>["tickets"]; total: number }>;
}
