/** The ticket workspace's row and board shapes, shared by the page, the API and the client. */
export type TicketWorkspaceTicket = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { username: string; displayName: string | null } | null;
  assignee: { username: string; displayName: string | null } | null;
};

export type TicketWorkspacePage = { tickets: TicketWorkspaceTicket[]; total: number; page: number };
export type TicketWorkspaceBoard = Record<"OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED", { tickets: TicketWorkspaceTicket[]; total: number }>;

type TicketRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  slaDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { username: string; displayName: string | null } | null;
  assignee: { username: string; displayName: string | null } | null;
};

export function toWorkspaceTicket(ticket: TicketRow): TicketWorkspaceTicket {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    creator: ticket.creator ? { username: ticket.creator.username, displayName: ticket.creator.displayName } : null,
    assignee: ticket.assignee ? { username: ticket.assignee.username, displayName: ticket.assignee.displayName } : null,
  };
}

export function toWorkspaceBoard(board: Record<string, { tickets: TicketRow[]; total: number }>): TicketWorkspaceBoard {
  return Object.fromEntries(
    Object.entries(board).map(([status, column]) => [status, { total: column.total, tickets: column.tickets.map(toWorkspaceTicket) }]),
  ) as TicketWorkspaceBoard;
}
