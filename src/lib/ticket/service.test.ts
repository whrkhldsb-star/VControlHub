import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { ticket: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() }, ticketComment: { create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createTicket, updateTicketStatus, addTicketComment } = await import("./service");
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
});
