import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { ticket: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, ticketComment: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createTicket, updateTicketStatus, addTicketComment, canViewTicket } = await import("./service");
describe("ticket service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates tickets and validates status transitions", async () => {
    mockPrisma.ticket.create.mockImplementation(async ({ data }: any) => ({ id: "tk1", ...data }));
    const ticket = await createTicket({ title: "Need VPS", description: "Please add node", createdBy: "u1" });
    expect(ticket.status).toBe("OPEN");
    await expect(updateTicketStatus({ id: "tk1", status: "BAD" })).rejects.toThrow(/状态无效/);
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
});
