import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { ticket: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, ticketComment: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createTicket, updateTicketStatus, addTicketComment, canViewTicket, listTickets } = await import("./service");
describe("ticket service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates tickets and validates status transitions", async () => {
    mockPrisma.ticket.create.mockImplementation(async ({ data }: any) => ({ id: "tk1", ...data }));
    const ticket = await createTicket({ title: "Need VPS", description: "Please add node", createdBy: "u1" });
    expect(ticket.status).toBe("OPEN");
    await expect(updateTicketStatus({ id: "tk1", status: "BAD" })).rejects.toThrow(/状态无效/);
  });

  it("updates assignee without requiring a status change", async () => {
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "OPEN", assigneeId: "u2" });

    await updateTicketStatus({ id: "tk1", assigneeId: "u2" });

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { assigneeId: "u2" },
    });
  });

  it("preserves assignee when status changes omit assigneeId and clears assignee only for explicit null", async () => {
    mockPrisma.ticket.update.mockResolvedValue({ id: "tk1" });

    await updateTicketStatus({ id: "tk1", status: "IN_PROGRESS" });
    await updateTicketStatus({ id: "tk1", assigneeId: null });

    expect(mockPrisma.ticket.update).toHaveBeenNthCalledWith(1, {
      where: { id: "tk1" },
      data: { status: "IN_PROGRESS", closedAt: null },
    });
    expect(mockPrisma.ticket.update).toHaveBeenNthCalledWith(2, {
      where: { id: "tk1" },
      data: { assigneeId: null },
    });
  });

  it("adds non-empty comments", async () => {
    await expect(addTicketComment({ ticketId: "tk1", authorId: "u1", body: "  " })).rejects.toThrow(/不能为空/);
  });

  it("returns comment authors for newly added comments", async () => {
    mockPrisma.ticketComment.create.mockResolvedValueOnce({ id: "c1", author: { id: "u1", username: "alice", displayName: null } });

    await addTicketComment({ ticketId: "tk1", authorId: "u1", body: " please check " });

    expect(mockPrisma.ticketComment.create).toHaveBeenCalledWith({
      data: { ticketId: "tk1", authorId: "u1", body: "please check" },
      include: { author: { select: { id: true, username: true, displayName: true } } },
    });
  });

  it("allows creators and assignees to view their own ticket", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u1", assigneeId: null });
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u2", assigneeId: "u1" });
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u2", assigneeId: null });

    await expect(canViewTicket("tk1", "u1")).resolves.toBe(true);
    await expect(canViewTicket("tk2", "u1")).resolves.toBe(true);
    await expect(canViewTicket("tk3", "u1")).resolves.toBe(false);
  });

  it("lists all tickets only when includeAll is explicit", async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);

    await listTickets({ userId: "u1", includeAll: false });
    await listTickets({ userId: "u1", includeAll: true });

    expect(mockPrisma.ticket.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { OR: [{ createdBy: "u1" }, { assigneeId: "u1" }] },
    }));
    expect(mockPrisma.ticket.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {},
    }));
  });
});
